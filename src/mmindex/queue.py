"""SQLite work queue with leasing, heartbeat and lease-timeout recovery.

One row is one file for one stage.  A worker claims a row inside a single
``BEGIN IMMEDIATE`` transaction so two machines can never claim the same file.
Stale claims (no heartbeat within the lease) are reset to ``pending`` by the
watchdog, which is safe because :class:`IncrementalCheckpoint` makes
re-processing a completed file a no-op.
"""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from .hashing import shard_for

SCHEMA = """
CREATE TABLE IF NOT EXISTS work_queue (
    task_id     TEXT PRIMARY KEY,
    file_id     TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    digest      TEXT NOT NULL,
    stage       TEXT NOT NULL,
    shard       INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'pending',
    worker_id   TEXT,
    claimed_at  REAL,
    heartbeat   REAL,
    retries     INTEGER DEFAULT 0,
    error_msg   TEXT,
    updated_at  REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS work_queue_stage_status ON work_queue(stage, status);
CREATE INDEX IF NOT EXISTS work_queue_shard ON work_queue(stage, status, shard);
CREATE TABLE IF NOT EXISTS queue_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

PENDING = "pending"
CLAIMED = "claimed"
DONE = "done"
FAILED = "failed"


def task_id(stage: str, file_id: str) -> str:
    """A task is one file in one stage; the same file appears once per stage."""
    return f"{stage}:{file_id}"


@dataclass
class Task:
    file_id: str
    file_path: str
    digest: str
    stage: str
    retries: int = 0
    task_id: str = ""


class WorkQueue:
    """Lease-based queue shared through a single SQLite file."""

    def __init__(
        self,
        db_path: str | Path,
        *,
        lease_seconds: float = 300.0,
        max_retries: int = 3,
    ) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.lease_seconds = lease_seconds
        self.max_retries = max_retries
        self._conn = sqlite3.connect(
            self.db_path, timeout=60.0, isolation_level=None, check_same_thread=False
        )
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=60000")
        self._conn.executescript(SCHEMA)

    # ------------------------------------------------------------- populate

    def enqueue(
        self,
        stage: str,
        entries: Iterable[tuple[str, str, str]],
        *,
        reset: bool = False,
        n_shards: int = 1,
    ) -> int:
        """Insert ``(file_id, file_path, digest)`` triples for a stage.

        ``n_shards`` fixes the partition used by every worker for this stage, so
        ``shard = xxhash64(file_path) % n_shards`` stays deterministic across
        machines and restarts.
        """
        if reset:
            self._conn.execute(
                "DELETE FROM work_queue WHERE stage=? AND status IN (?,?)",
                (stage, PENDING, CLAIMED),
            )
        now = time.time()
        rows = [
            (task_id(stage, fid), fid, path, digest, stage, shard_for(path, n_shards), now)
            for fid, path, digest in entries
        ]
        self._conn.executemany(
            "INSERT OR IGNORE INTO work_queue "
            "(task_id, file_id, file_path, digest, stage, shard, updated_at)"
            " VALUES (?,?,?,?,?,?,?)",
            rows,
        )
        self.set_meta(f"n_shards:{stage}", str(n_shards))
        return len(rows)

    def n_shards(self, stage: str) -> int:
        return int(self.get_meta(f"n_shards:{stage}", "1") or 1)

    def set_meta(self, key: str, value: str) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO queue_meta (key, value) VALUES (?,?)", (key, value)
        )

    def get_meta(self, key: str, default: str | None = None) -> str | None:
        row = self._conn.execute("SELECT value FROM queue_meta WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default

    def stats(self, stage: str | None = None) -> dict[str, int]:
        if stage:
            rows = self._conn.execute(
                "SELECT status, COUNT(*) AS n FROM work_queue WHERE stage=? GROUP BY status",
                (stage,),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT status, COUNT(*) AS n FROM work_queue GROUP BY status"
            ).fetchall()
        return {row["status"]: int(row["n"]) for row in rows}

    def remaining(self, stage: str) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) AS n FROM work_queue WHERE stage=? AND status IN (?,?,?)",
            (stage, PENDING, CLAIMED, FAILED),
        ).fetchone()
        return int(row["n"])

    def is_complete(self, stage: str) -> bool:
        return self.remaining(stage) == 0

    # --------------------------------------------------------------- claim

    def claim(
        self,
        stage: str,
        worker_id: str,
        *,
        shard: int | None = None,
    ) -> Task | None:
        """Atomically claim one pending row, or ``None`` when the stage is drained."""
        now = time.time()
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            sql = "SELECT * FROM work_queue WHERE stage=? AND status=? "
            params: list = [stage, PENDING]
            if shard is not None:
                sql += "AND shard=? "
                params.append(shard)
            sql += "ORDER BY file_id LIMIT 1"
            row = self._conn.execute(sql, params).fetchone()
            if row is None:
                self._conn.execute("COMMIT")
                return None
            self._conn.execute(
                "UPDATE work_queue SET status=?, worker_id=?, claimed_at=?, heartbeat=?,"
                " updated_at=? WHERE task_id=?",
                (CLAIMED, worker_id, now, now, now, row["task_id"]),
            )
            self._conn.execute("COMMIT")
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        return Task(
            file_id=row["file_id"],
            file_path=row["file_path"],
            digest=row["digest"],
            stage=row["stage"],
            retries=int(row["retries"] or 0),
            task_id=row["task_id"],
        )

    def heartbeat(self, task_id: str) -> None:
        self._conn.execute(
            "UPDATE work_queue SET heartbeat=?, updated_at=? WHERE task_id=?",
            (time.time(), time.time(), task_id),
        )

    def mark_done(self, task_id: str) -> None:
        now = time.time()
        self._conn.execute(
            "UPDATE work_queue SET status=?, error_msg=NULL, heartbeat=?, updated_at=?"
            " WHERE task_id=?",
            (DONE, now, now, task_id),
        )

    def mark_failed(self, task_id: str, error: str) -> None:
        """Fail a row, re-queueing it while retries remain."""
        now = time.time()
        row = self._conn.execute(
            "SELECT retries FROM work_queue WHERE task_id=?", (task_id,)
        ).fetchone()
        retries = int(row["retries"] or 0) + 1 if row else 1
        status = PENDING if retries <= self.max_retries else FAILED
        self._conn.execute(
            "UPDATE work_queue SET status=?, retries=?, error_msg=?, heartbeat=?, updated_at=?"
            " WHERE task_id=?",
            (status, retries, error[:2000], now, now, task_id),
        )

    def release(self, task_id: str) -> None:
        """Return a claimed row to ``pending`` without counting a retry."""
        now = time.time()
        self._conn.execute(
            "UPDATE work_queue SET status=?, worker_id=NULL, claimed_at=NULL, updated_at=?"
            " WHERE task_id=?",
            (PENDING, now, task_id),
        )

    # ------------------------------------------------------------- watchdog

    def reclaim_stale(self, lease_seconds: float | None = None) -> int:
        """Reset claims whose heartbeat is older than the lease."""
        lease = self.lease_seconds if lease_seconds is None else lease_seconds
        cutoff = time.time() - lease
        cur = self._conn.execute(
            "UPDATE work_queue SET status=?, worker_id=NULL, claimed_at=NULL,"
            " error_msg='lease expired', updated_at=? "
            "WHERE status=? AND (heartbeat IS NULL OR heartbeat < ?)",
            (PENDING, time.time(), CLAIMED, cutoff),
        )
        return cur.rowcount

    def retry_failed(self, stage: str | None = None) -> int:
        now = time.time()
        if stage:
            cur = self._conn.execute(
                "UPDATE work_queue SET status=?, retries=0, error_msg=NULL, updated_at=?"
                " WHERE status=? AND stage=?",
                (PENDING, now, FAILED, stage),
            )
        else:
            cur = self._conn.execute(
                "UPDATE work_queue SET status=?, retries=0, error_msg=NULL, updated_at=?"
                " WHERE status=?",
                (PENDING, now, FAILED),
            )
        return cur.rowcount

    def failures(self, stage: str | None = None, limit: int = 50) -> list[dict]:
        sql = "SELECT file_path, stage, retries, error_msg FROM work_queue WHERE status=?"
        params: list = [FAILED]
        if stage:
            sql += " AND stage=?"
            params.append(stage)
        sql += " ORDER BY updated_at DESC LIMIT ?"
        params.append(limit)
        return [dict(row) for row in self._conn.execute(sql, params).fetchall()]

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> "WorkQueue":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
