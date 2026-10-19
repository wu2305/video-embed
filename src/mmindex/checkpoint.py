"""Resumable checkpoint store: local SQLite plus immutable gzip delta shards.

Each completed unit is written with an atomic transaction under an exclusive
file lock.  A background thread drains an outbox into numbered, append-only
gzip shards so other machines can replay progress without touching the writer's
database.  Re-processing a unit that is already stored is a no-op, which is what
makes every pipeline stage idempotent and safe to preempt (section 4.1).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from . import codec

try:  # POSIX advisory locking
    import fcntl
except ImportError:  # pragma: no cover - Windows
    fcntl = None  # type: ignore[assignment]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS records (
    path       TEXT NOT NULL,
    digest     TEXT NOT NULL,
    stage      TEXT NOT NULL,
    payload    BLOB NOT NULL,
    payload_sha TEXT NOT NULL,
    updated_at REAL NOT NULL,
    PRIMARY KEY (path, digest, stage)
);
CREATE INDEX IF NOT EXISTS records_stage ON records(stage);
CREATE TABLE IF NOT EXISTS outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    digest TEXT NOT NULL,
    stage TEXT NOT NULL,
    payload_sha TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS applied_shards (
    name TEXT PRIMARY KEY,
    applied_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class CheckpointConflict(RuntimeError):
    """Raised when a guarded checkpoint would overwrite divergent content."""


class IncrementalCheckpoint:
    """SQLite-backed store with gzip delta shard synchronisation."""

    def __init__(
        self,
        db_path: str | Path,
        *,
        stage: str = "infer",
        shard_dir: str | Path | None = None,
        auto_sync: bool = True,
        sync_interval: float = 5.0,
        namespace: str = "default",
    ) -> None:
        self.db_path = Path(db_path)
        self.stage = stage
        self.namespace = namespace
        self.shard_dir = Path(shard_dir) if shard_dir else self.db_path.parent / "shards"
        self.sync_interval = sync_interval
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.shard_dir.mkdir(parents=True, exist_ok=True)
        self._lock_path = self.db_path.with_suffix(self.db_path.suffix + ".lock")
        self._conn = sqlite3.connect(self.db_path, timeout=60.0, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._mutex = threading.RLock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        with self._mutex:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.executescript(_SCHEMA)
            self._conn.commit()
        self.writer_id = self._ensure_writer_id()
        self._baseline: dict[tuple[str, str, str], str] = {}
        self._capture_baseline()
        if auto_sync:
            self._thread = threading.Thread(
                target=self._sync_loop, name="checkpoint-sync", daemon=True
            )
            self._thread.start()

    # ------------------------------------------------------------------ locks

    @contextmanager
    def _exclusive(self):
        if fcntl is None:
            with self._mutex:
                yield
            return
        handle = open(self._lock_path, "a+")
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            with self._mutex:
                yield
        finally:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            finally:
                handle.close()

    # ------------------------------------------------------------- baseline

    def _capture_baseline(self) -> None:
        with self._mutex:
            rows = self._conn.execute(
                "SELECT path, digest, stage, payload_sha FROM records"
            ).fetchall()
        self._baseline = {(r["path"], r["digest"], r["stage"]): r["payload_sha"] for r in rows}

    # ------------------------------------------------------------ core API

    def get(self, path: str, digest: str, stage: str | None = None) -> dict | None:
        """Return the stored record, or ``None`` when this unit is not done."""
        with self._mutex:
            row = self._conn.execute(
                "SELECT payload FROM records WHERE path=? AND digest=? AND stage=?",
                (path, digest, stage or self.stage),
            ).fetchone()
        if row is None:
            return None
        return codec.loads(row["payload"])

    def has(self, path: str, digest: str, stage: str | None = None) -> bool:
        with self._mutex:
            row = self._conn.execute(
                "SELECT 1 FROM records WHERE path=? AND digest=? AND stage=?",
                (path, digest, stage or self.stage),
            ).fetchone()
        return row is not None

    def put(self, path: str, digest: str, result: dict) -> bool:
        """Atomically store ``result``.  Returns ``False`` for an identical no-op."""
        payload = codec.dumps(result)
        payload_sha = hashlib.sha256(payload).hexdigest()
        key = (path, digest, self.stage)
        baseline_sha = self._baseline.get(key)
        if baseline_sha is not None and baseline_sha != payload_sha:
            raise CheckpointConflict(
                f"refusing to overwrite {path} ({digest}) in stage {self.stage}: "
                "payload differs from the snapshot taken at startup"
            )
        with self._exclusive():
            existing = self._conn.execute(
                "SELECT payload_sha FROM records WHERE path=? AND digest=? AND stage=?",
                (path, digest, self.stage),
            ).fetchone()
            if existing is not None and existing["payload_sha"] == payload_sha:
                return False
            now = time.time()
            self._conn.execute(
                "INSERT OR REPLACE INTO records "
                "(path, digest, stage, payload, payload_sha, updated_at) VALUES (?,?,?,?,?,?)",
                (path, digest, self.stage, payload, payload_sha, now),
            )
            self._conn.execute(
                "INSERT INTO outbox (path, digest, stage, payload_sha, created_at) "
                "VALUES (?,?,?,?,?)",
                (path, digest, self.stage, payload_sha, now),
            )
            self._conn.commit()
        self._baseline[key] = payload_sha
        return True

    def delete(self, path: str, digest: str) -> bool:
        with self._exclusive():
            cur = self._conn.execute(
                "DELETE FROM records WHERE path=? AND digest=? AND stage=?",
                (path, digest, self.stage),
            )
            self._conn.commit()
            return cur.rowcount > 0

    def count(self, stage: str | None = None) -> int:
        stage = stage or self.stage
        with self._mutex:
            row = self._conn.execute(
                "SELECT COUNT(*) AS n FROM records WHERE stage=?", (stage,)
            ).fetchone()
        return int(row["n"])

    def records(self, stage: str | None = None) -> Iterator[tuple[str, str, dict]]:
        """Yield ``(path, digest, record)`` for a stage, ordered by path."""
        stage = stage or self.stage
        with self._mutex:
            rows = self._conn.execute(
                "SELECT path, digest, payload FROM records WHERE stage=? ORDER BY path",
                (stage,),
            ).fetchall()
        for row in rows:
            yield row["path"], row["digest"], codec.loads(row["payload"])

    def pending_outbox(self) -> int:
        with self._mutex:
            row = self._conn.execute("SELECT COUNT(*) AS n FROM outbox").fetchone()
        return int(row["n"])

    # ------------------------------------------------------------- sharding

    def _ensure_writer_id(self) -> str:
        """A stable id for this database, minted once and kept in its meta table.

        Shard names embed it, so two machines with separate local databases can
        never pick the same shard name and overwrite each other's progress.
        """
        with self._exclusive():
            row = self._conn.execute("SELECT value FROM meta WHERE key='writer_id'").fetchone()
            if row:
                return row["value"]
            writer_id = uuid.uuid4().hex[:12]
            self._conn.execute("INSERT INTO meta (key, value) VALUES ('writer_id', ?)", (writer_id,))
            self._conn.commit()
            return writer_id

    def _next_shard_path(self) -> tuple[Path, int]:
        row = self._conn.execute("SELECT value FROM meta WHERE key='shard_seq'").fetchone()
        seq = int(row["value"]) if row else 0
        while True:
            seq += 1
            target = self.shard_dir / f"shard-{self.writer_id}-{seq:06d}.json.gz"
            if not target.exists():
                return target, seq

    def sync(self) -> Path | None:
        """Drain the outbox into one new immutable gzip shard.

        Shards are named ``shard-<writer>-<seq>.json.gz`` and are never replaced:
        the name is unique to this database, and an existing file is skipped over.
        """
        with self._exclusive():
            cursor = self._conn.execute(
                "SELECT o.path, o.digest, o.stage, o.payload_sha, o.created_at, r.payload "
                "FROM outbox o LEFT JOIN records r "
                "ON r.path=o.path AND r.digest=o.digest AND r.stage=o.stage "
                "ORDER BY o.seq"
            )
            row = cursor.fetchone()
            if row is None:
                return None
            target, seq = self._next_shard_path()
            name = target.name
            tmp = target.with_suffix(".json.gz.tmp")
            with gzip.open(tmp, "wb", compresslevel=6) as handle:
                while row is not None:
                    if row["payload"] is not None:
                        envelope = {
                            "path": row["path"],
                            "digest": row["digest"],
                            "stage": row["stage"],
                            "payload_sha": row["payload_sha"],
                            "created_at": row["created_at"],
                            "payload": row["payload"].decode("utf-8"),
                        }
                        handle.write(json.dumps(envelope).encode())
                        handle.write(b"\n")
                    row = cursor.fetchone()
            os.replace(tmp, target)
            self._conn.execute("DELETE FROM outbox")
            self._conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('shard_seq', ?)", (str(seq),)
            )
            self._conn.execute(
                "INSERT OR REPLACE INTO applied_shards (name, applied_at) VALUES (?,?)",
                (name, time.time()),
            )
            self._conn.commit()
        return target

    def import_shards(self) -> int:
        """Apply shards written by other machines.  Returns rows inserted.

        Each shard is applied in one transaction, and every payload is checked
        against the hash its writer recorded, so a damaged shard fails loudly
        instead of seeding the checkpoint with corrupt records.
        """
        applied = 0
        for shard in sorted(self.shard_dir.glob("shard-*.json.gz")):
            with self._mutex:
                seen = self._conn.execute(
                    "SELECT 1 FROM applied_shards WHERE name=?", (shard.name,)
                ).fetchone()
            if seen:
                continue
            rows = []
            with gzip.open(shard, "rb") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    envelope = json.loads(line)
                    payload = envelope["payload"].encode("utf-8")
                    payload_sha = hashlib.sha256(payload).hexdigest()
                    expected = envelope.get("payload_sha")
                    if expected and expected != payload_sha:
                        raise CheckpointConflict(
                            f"shard {shard.name} is corrupt: payload for "
                            f"{envelope['path']} does not match its recorded hash"
                        )
                    rows.append(
                        (
                            envelope["path"],
                            envelope["digest"],
                            envelope["stage"],
                            payload,
                            payload_sha,
                            envelope.get("created_at", time.time()),
                        )
                    )
            with self._exclusive():
                self._conn.executemany(
                    "INSERT OR IGNORE INTO records "
                    "(path, digest, stage, payload, payload_sha, updated_at) "
                    "VALUES (?,?,?,?,?,?)",
                    rows,
                )
                self._conn.execute(
                    "INSERT OR REPLACE INTO applied_shards (name, applied_at) VALUES (?,?)",
                    (shard.name, time.time()),
                )
                self._conn.commit()
            applied += len(rows)
        self._capture_baseline()
        return applied

    # --------------------------------------------------------------- meta

    def set_meta(self, key: str, value: str) -> None:
        with self._exclusive():
            self._conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)", (key, value)
            )
            self._conn.commit()

    def get_meta(self, key: str, default: str | None = None) -> str | None:
        with self._mutex:
            row = self._conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default

    # -------------------------------------------------------------- thread

    def _sync_loop(self) -> None:
        while not self._stop.wait(self.sync_interval):
            try:
                self.sync()
            except Exception:  # pragma: no cover - background best effort
                continue

    def close(self, sync: bool = True) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=self.sync_interval + 1)
        if sync:
            try:
                self.sync()
            except Exception:
                pass
        with self._mutex:
            self._conn.close()

    def __enter__(self) -> "IncrementalCheckpoint":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


class GuardedCheckpoint(IncrementalCheckpoint):
    """Checkpoint that refuses to overwrite payloads divergent from its baseline.

    The baseline is captured at construction time.  Any ``put`` whose payload
    hash disagrees with a baseline record raises :class:`CheckpointConflict`,
    which protects the production snapshot from accidental re-inference.
    """

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._frozen = dict(self._baseline)

    def put(self, path: str, digest: str, result: dict) -> bool:
        payload = codec.dumps(result)
        payload_sha = hashlib.sha256(payload).hexdigest()
        frozen_sha = self._frozen.get((path, digest, self.stage))
        if frozen_sha is not None and frozen_sha != payload_sha:
            raise CheckpointConflict(
                f"guarded checkpoint: {path} ({digest}) in stage {self.stage} "
                "would be overwritten with different content"
            )
        return super().put(path, digest, result)
