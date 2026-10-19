#!/usr/bin/env python3
"""A small query console for the published index — the PoC, made visible.

Serves one page with a query box over the exported snapshot, plus the mechanics
behind each result (embed -> filter -> rank, with timings). It is deliberately
dependency-free: the standard library serves it, `mmindex` does the search, so
it runs in the CNB dev container exactly as the CLI does.

    # in the CNB dev environment, after scripts/benchmark.py has built an index
    python scripts/serve.py --work-dir /opt/benchmark_work --port 8000

Then forward the port to your laptop (CNB exposes container ports; any tunnel
works) and open http://localhost:8000.

Endpoints:
    GET /                      the console
    GET /api/info              snapshot, backend, counts, persons
    GET /api/search?q=...      ranked hits + timings
    GET /api/thumb?id=N        cached JPEG thumbnail for unit N
    GET /api/source?id=N       the original file, as stored (images and videos)
"""

from __future__ import annotations

import argparse
import io
import json
import sqlite3
import sys
import threading
import time
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

THUMB_EDGE = 480
THUMB_CACHE_LIMIT = 512


class Server:
    """Holds the one Index and the one backend, shared by request threads."""

    def __init__(self, layout, settings, backend_name: str) -> None:
        from mmindex.backends import build_backend
        from mmindex.search import Index

        self.layout = layout
        self.settings = settings
        self.settings.backend = backend_name
        self.index = Index.open(layout, settings)
        self.backend = build_backend(settings)
        # A text tower is not cheap and not obviously thread-safe; serialise it.
        self._embed_lock = threading.Lock()
        self._thumb_lock = threading.Lock()
        self._thumbs: dict[int, bytes] = {}

    def close(self) -> None:
        self.backend.close()

    # ---------------------------------------------------------------- search

    def search(self, query: str, **kwargs) -> dict:
        started = time.perf_counter()
        with self._embed_lock:
            vector = self.backend.embed_text(query)
        embedded = time.perf_counter()
        hits = self.index.search(vector, text=query, **kwargs)
        finished = time.perf_counter()
        return {
            "hits": [hit.to_dict() for hit in hits],
            "timing": {
                "embed_ms": round((embedded - started) * 1000, 1),
                "rank_ms": round((finished - embedded) * 1000, 1),
                "total_ms": round((finished - started) * 1000, 1),
            },
            "query_dims": int(vector.shape[0]),
        }

    def info(self) -> dict:
        rows = self._query("SELECT COUNT(*) AS n FROM units")[0]["n"]
        masters = self._query("SELECT COUNT(*) AS n FROM units WHERE is_master = 1")[0]["n"]
        return {
            "snapshot": self.index.snapshot_dir.name,
            "snapshot_dir": str(self.index.snapshot_dir),
            "backend": self.index.backend or self.backend.name,
            "units": int(rows),
            "masters": int(masters),
            "matrix": list(self.index.matrix.shape),
            "dtype": str(self.index.matrix.dtype),
            "persons": [
                {
                    "id": p.get("person_id"),
                    "faces": p.get("face_count"),
                }
                for p in self.index.persons()
                if p.get("person_id")
            ],
            "text_bonus": self.settings.text_bonus,
        }

    # --------------------------------------------------------------- media

    def _query(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        conn = sqlite3.connect(self.index.db_path)
        conn.row_factory = sqlite3.Row
        try:
            return conn.execute(sql, params).fetchall()
        finally:
            conn.close()

    def unit(self, unit_id: int) -> sqlite3.Row | None:
        rows = self._query("SELECT * FROM units WHERE unit_id = ?", (int(unit_id),))
        return rows[0] if rows else None

    def thumbnail(self, unit_id: int) -> bytes | None:
        """A bounded JPEG for one unit, cached.

        Only paths that appear in the `units` table are ever opened, so the
        endpoint cannot be used to read arbitrary files from the container.
        """
        with self._thumb_lock:
            cached = self._thumbs.get(unit_id)
        if cached is not None:
            return cached

        row = self.unit(unit_id)
        if row is None:
            return None
        path = Path(row["path"])
        if not path.is_file():
            return None

        image = None
        if row["kind"] == "image":
            try:
                from PIL import Image, ImageOps

                with Image.open(path) as opened:
                    image = ImageOps.exif_transpose(opened).convert("RGB")
            except Exception:
                return None
        else:
            # Frames are deleted after infer, so re-read one from the video.
            try:
                import cv2

                capture = cv2.VideoCapture(str(path))
                if not capture.isOpened():
                    return None
                try:
                    start = float(row["scene_start"] or 0.0)
                    end = float(row["scene_end"] or start)
                    capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, (start + end) / 2) * 1000.0)
                    ok, frame = capture.read()
                finally:
                    capture.release()
                if not ok:
                    return None
                from PIL import Image

                image = Image.fromarray(frame[:, :, ::-1])
            except Exception:
                return None

        from PIL import Image

        image.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=85)
        payload = buffer.getvalue()

        with self._thumb_lock:
            if len(self._thumbs) >= THUMB_CACHE_LIMIT:
                self._thumbs.clear()
            self._thumbs[unit_id] = payload
        return payload

    def source(self, unit_id: int) -> tuple[Path, str] | None:
        """The stored file and its MIME type, for streaming."""
        row = self.unit(unit_id)
        if row is None:
            return None
        path = Path(row["path"])
        if not path.is_file():
            return None
        suffix = path.suffix.lower()
        mime = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".bmp": "image/bmp",
            ".tif": "image/tiff",
            ".tiff": "image/tiff",
            ".mp4": "video/mp4",
            ".m4v": "video/mp4",
            ".mov": "video/quicktime",
            ".webm": "video/webm",
            ".mkv": "video/x-matroska",
            ".avi": "video/x-msvideo",
        }.get(suffix, "application/octet-stream")
        return path, mime


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mmindex — query console</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --line: #262b36; --text: #e6e9ef;
    --muted: #8b94a7; --accent: #6ea8fe; --good: #59d18c; --warn: #e5c07b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.5 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  header {
    display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline;
    padding: 16px 22px; border-bottom: 1px solid var(--line); background: var(--panel);
  }
  header h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: .2px; }
  .badge {
    font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    padding: 4px 7px; border: 1px solid var(--line); border-radius: 5px;
    color: var(--muted); background: #12151b;
  }
  .badge b { color: var(--good); font-weight: 600; }
  main { padding: 18px 22px 60px; max-width: 1180px; margin: 0 auto; }
  form {
    display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end;
    background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px; margin-bottom: 16px;
  }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field label { font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); }
  input, select, button {
    font: inherit; color: var(--text); background: #12151b;
    border: 1px solid var(--line); border-radius: 7px; padding: 8px 10px;
  }
  input[type=text] { min-width: 320px; }
  input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  button {
    cursor: pointer; background: var(--accent); color: #0b0d11;
    border-color: transparent; font-weight: 600; padding: 8px 18px;
    min-height: 38px;
  }
  button:disabled { opacity: .5; cursor: default; }
  .check {
    display: flex; gap: 6px; align-items: center; color: var(--muted);
    min-height: 38px; padding-bottom: 1px;
  }
  .check input { width: 15px; height: 15px; accent-color: var(--accent); }
  #mechanics {
    display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted);
  }
  #mechanics .step {
    background: var(--panel); border: 1px solid var(--line); border-radius: 7px;
    padding: 7px 10px;
  }
  #mechanics .step b { color: var(--text); font-weight: 600; }
  #mechanics .step.accent b { color: var(--accent); }
  #status { color: var(--muted); margin-bottom: 14px; min-height: 20px; }
  #status.error { color: #ff8b8b; }
  .grid {
    display: grid; gap: 14px;
    grid-template-columns: repeat(auto-fill, minmax(212px, 1fr));
  }
  .card {
    background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
    overflow: hidden; display: flex; flex-direction: column;
  }
  .thumb {
    position: relative; background: #0b0d11; aspect-ratio: 4 / 3;
    display: flex; align-items: center; justify-content: center; overflow: hidden;
  }
  .thumb img, .thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .rank {
    position: absolute; top: 8px; left: 8px; font: 11px/1 ui-monospace, monospace;
    background: rgba(0,0,0,.72); border-radius: 5px; padding: 4px 6px; color: #fff;
  }
  .score {
    position: absolute; bottom: 8px; right: 8px; font: 11px/1 ui-monospace, monospace;
    background: rgba(0,0,0,.72); border-radius: 5px; padding: 4px 6px; color: var(--good);
  }
  .body { padding: 9px 11px 11px; display: flex; flex-direction: column; gap: 5px; }
  .name { font-size: 12px; word-break: break-all; }
  .meta { font: 11px/1.45 ui-monospace, monospace; color: var(--muted); }
  .meta .tag {
    display: inline-block; border: 1px solid var(--line); border-radius: 4px;
    padding: 1px 5px; margin-right: 4px;
  }
  .text {
    font-size: 11px; color: var(--warn); border-left: 2px solid var(--warn);
    padding-left: 7px; display: -webkit-box; -webkit-line-clamp: 3;
    -webkit-box-orient: vertical; overflow: hidden;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .empty { color: var(--muted); padding: 30px 0; }
</style>
</head>
<body>
<header>
  <h1>mmindex — query console</h1>
  <span class="badge">snapshot <b id="snapshot">…</b></span>
  <span class="badge">backend <b id="backend">…</b></span>
  <span class="badge">units <b id="units">…</b></span>
  <span class="badge">matrix <b id="matrix">…</b></span>
</header>

<main>
  <form id="form">
    <div class="field" style="flex:1">
      <label for="q">query</label>
      <input type="text" id="q" placeholder="a man in a suit" autocomplete="off" autofocus>
    </div>
    <div class="field">
      <label for="limit">limit</label>
      <input type="number" id="limit" value="12" min="1" max="60" style="width:80px">
    </div>
    <div class="field">
      <label for="person">person</label>
      <select id="person" style="min-width:150px"><option value="">any</option></select>
    </div>
    <div class="field">
      <label for="min_faces">min faces</label>
      <input type="number" id="min_faces" value="0" min="0" max="20" style="width:90px">
    </div>
    <div class="field">
      <label for="min_score">min score</label>
      <input type="number" id="min_score" value="" step="0.01" placeholder="—" style="width:90px">
    </div>
    <label class="check"><input type="checkbox" id="include_non_master"> non-master</label>
    <button type="submit" id="go">search</button>
  </form>

  <div id="mechanics"></div>
  <div id="status"></div>
  <div class="grid" id="results"></div>
</main>

<script>
const $ = (id) => document.getElementById(id);
const state = { info: null };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function fmt(ms) { return ms >= 1000 ? (ms / 1000).toFixed(2) + " s" : ms.toFixed(1) + " ms"; }

function mechanics(html) { $("mechanics").innerHTML = html; }

function step(label, value, accent) {
  return `<div class="step${accent ? " accent" : ""}">${label} <b>${value}</b></div>`;
}

async function loadInfo() {
  const res = await fetch("/api/info");
  const info = await res.json();
  state.info = info;
  $("snapshot").textContent = info.snapshot;
  $("backend").textContent = info.backend;
  $("units").textContent = info.units + " (" + info.masters + " masters)";
  $("matrix").textContent = info.matrix.join("×") + " " + info.dtype;
  const person = $("person");
  for (const p of info.persons) {
    const option = document.createElement("option");
    option.value = p.id;
    option.textContent = p.id + " (" + (p.faces ?? "?") + ")";
    person.appendChild(option);
  }
  mechanics(
    step("1 · embed", "SigLIP text → " + info.matrix[1] + " dims") +
    step("2 · filter", "SQLite units table, " + info.masters + " masters") +
    step("3 · rank", "matrix @ query, +" + info.text_bonus + " text bonus", true)
  );
}

function card(hit, rank) {
  const name = hit.path.split("/").pop();
  const media = hit.kind === "video"
    ? `<video src="/api/source?id=${hit.unit_id}" muted preload="metadata" playsinline></video>`
    : `<img loading="lazy" src="/api/thumb?id=${hit.unit_id}" alt="">`;
  const tags = [];
  tags.push(`<span class="tag">${esc(hit.kind)}</span>`);
  if (hit.face_count) tags.push(`<span class="tag">${hit.face_count} face${hit.face_count > 1 ? "s" : ""}</span>`);
  for (const person of hit.person_ids) tags.push(`<span class="tag">${esc(person)}</span>`);
  if (!hit.is_master) tags.push(`<span class="tag" style="color:var(--warn)">copy</span>`);
  const text = (hit.ocr_text || hit.asr_text || "").trim();
  const bonus = hit.text_bonus ? ` +${hit.text_bonus.toFixed(2)} text` : "";
  return `<div class="card">
    <div class="thumb">
      ${media}
      <span class="rank">${rank}</span>
      <span class="score">${hit.score.toFixed(3)}${bonus}</span>
    </div>
    <div class="body">
      <div class="name" title="${esc(hit.path)}">${esc(name)}</div>
      <div class="meta">sim ${hit.similarity.toFixed(3)} · unit ${hit.unit_index}</div>
      <div class="meta">${tags.join("")}</div>
      ${text ? `<div class="text">${esc(text.slice(0, 180))}</div>` : ""}
    </div>
  </div>`;
}

async function run(event) {
  event.preventDefault();
  const query = $("q").value.trim();
  if (!query) { $("q").focus(); return; }

  const params = new URLSearchParams({ q: query, limit: $("limit").value });
  if ($("person").value) params.set("person", $("person").value);
  if (+$("min_faces").value) params.set("min_faces", $("min_faces").value);
  if ($("min_score").value !== "") params.set("min_score", $("min_score").value);
  if ($("include_non_master").checked) params.set("include_non_master", "1");

  $("go").disabled = true;
  $("status").className = "";
  $("status").textContent = "searching…";
  try {
    const res = await fetch("/api/search?" + params);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    const info = state.info;
    mechanics(
      step("1 · embed", "text → " + data.query_dims + " dims", false) +
      step("2 · filter", "candidates scored", false) +
      step("3 · rank", "top " + data.hits.length, true) +
      step("embed", fmt(data.timing.embed_ms)) +
      step("rank", fmt(data.timing.rank_ms)) +
      step("total", fmt(data.timing.total_ms))
    );
    $("status").textContent = data.hits.length
      ? `${data.hits.length} hits for “${query}”`
      : `no hits for “${query}”`;
    $("results").innerHTML = data.hits.map((hit, index) => card(hit, index + 1)).join("");
  } catch (error) {
    $("status").className = "error";
    $("status").textContent = "error: " + error.message;
    $("results").innerHTML = "";
  } finally {
    $("go").disabled = false;
  }
}

$("form").addEventListener("submit", run);
loadInfo().catch((error) => {
  $("status").className = "error";
  $("status").textContent = "cannot reach the index: " + error.message;
});
</script>
</body>
</html>
"""


def build_handler(server: Server):
    class Handler(BaseHTTPRequestHandler):
        server_version = "mmindex-console/1.0"

        def log_message(self, fmt: str, *args) -> None:
            # Keep the console readable; one line per request is enough.
            sys.stderr.write(f"{self.address_string()} {fmt % args}\n")

        # ------------------------------------------------------------ helpers

        def _send(self, status: int, body: bytes, mime: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, payload: object, status: int = HTTPStatus.OK) -> None:
            body = json.dumps(payload, default=str).encode()
            self._send(status, body, "application/json")

        def _error(self, status: int, message: str) -> None:
            self._json({"error": message}, status)

        # ---------------------------------------------------------------- GET

        def do_GET(self) -> None:  # noqa: N802 - stdlib naming
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            query = urllib.parse.parse_qs(parsed.query)

            try:
                if path == "/":
                    self._send(HTTPStatus.OK, PAGE.encode(), "text/html; charset=utf-8")
                    return
                if path == "/api/info":
                    self._json(server.info())
                    return
                if path == "/api/search":
                    self._search(query)
                    return
                if path == "/api/thumb":
                    self._thumb(query)
                    return
                if path == "/api/source":
                    self._source(query)
                    return
                self._error(HTTPStatus.NOT_FOUND, f"no route {path}")
            except BrokenPipeError:
                pass
            except ValueError as exc:  # a bad query parameter, not a server fault
                self._error(HTTPStatus.BAD_REQUEST, str(exc))
            except Exception as exc:  # keep the console up on a bad request
                self._error(HTTPStatus.INTERNAL_SERVER_ERROR, f"{type(exc).__name__}: {exc}")

        def _search(self, query: dict) -> None:
            text = (query.get("q") or [""])[0].strip()
            if not text:
                self._error(HTTPStatus.BAD_REQUEST, "missing q")
                return

            def number(name: str, default=None, cast=float):
                raw = (query.get(name) or [None])[0]
                if raw in (None, ""):
                    return default
                try:
                    return cast(raw)
                except ValueError:
                    raise ValueError(f"{name} must be a number, got {raw!r}")

            limit = max(1, min(60, number("limit", 12, int)))
            result = server.search(
                text,
                limit=limit,
                person_id=(query.get("person") or [None])[0] or None,
                min_faces=max(0, number("min_faces", 0, int)),
                min_score=number("min_score", None, float),
                include_non_master=bool(query.get("include_non_master")),
            )
            self._json(result)

        def _unit_id(self, query: dict) -> int | None:
            raw = (query.get("id") or [None])[0]
            if raw is None:
                return None
            try:
                return int(raw)
            except ValueError:
                return None

        def _thumb(self, query: dict) -> None:
            unit_id = self._unit_id(query)
            if unit_id is None:
                self._error(HTTPStatus.BAD_REQUEST, "missing or invalid id")
                return
            payload = server.thumbnail(unit_id)
            if payload is None:
                self._error(HTTPStatus.NOT_FOUND, "no thumbnail for that unit")
                return
            self._send(HTTPStatus.OK, payload, "image/jpeg")

        def _source(self, query: dict) -> None:
            unit_id = self._unit_id(query)
            if unit_id is None:
                self._error(HTTPStatus.BAD_REQUEST, "missing or invalid id")
                return
            found = server.source(unit_id)
            if found is None:
                self._error(HTTPStatus.NOT_FOUND, "source file not available")
                return
            path, mime = found
            self._stream(path, mime)

        def _stream(self, path: Path, mime: str) -> None:
            """Send a file, honouring a single ``Range`` request.

            Browsers will not play a video served with a plain 200 and no
            ``Accept-Ranges``: they need 206 responses to seek and to start
            playback at all. Images work either way, so this one path serves
            both.
            """
            size = path.stat().st_size
            start, end = 0, size - 1
            header = self.headers.get("Range")
            partial = False
            if header and header.startswith("bytes=") and size:
                spec = header[len("bytes=") :].split(",")[0].strip()
                first, _, last = spec.partition("-")
                try:
                    if first:
                        start = int(first)
                        end = int(last) if last else size - 1
                    elif last:  # suffix range: the final N bytes
                        start = max(0, size - int(last))
                    if start > end or start >= size:
                        self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                        self.send_header("Content-Range", f"bytes */{size}")
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return
                    end = min(end, size - 1)
                    partial = True
                except ValueError:
                    start, end, partial = 0, size - 1, False

            length = end - start + 1 if size else 0
            self.send_response(
                HTTPStatus.PARTIAL_CONTENT if partial else HTTPStatus.OK
            )
            self.send_header("Content-Type", mime)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(length))
            if partial:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            if not length:
                return
            with path.open("rb") as handle:
                handle.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = handle.read(min(64 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve a query console over the index.")
    parser.add_argument("--work-dir", default="/opt/benchmark_work")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="0.0.0.0 so a port forward from outside the container reaches it",
    )
    parser.add_argument("--backend", default="auto", choices=["auto", "ml", "hash"])
    args = parser.parse_args()

    from mmindex.config import Layout, Settings

    settings = Settings.from_env()
    settings.backend = args.backend
    layout = Layout(Path(args.work_dir))

    try:
        server = Server(layout, settings, args.backend)
    except FileNotFoundError as exc:
        print(f"no index to serve: {exc}", file=sys.stderr)
        print(
            "hint: build one with `python scripts/benchmark.py`, or pass --work-dir",
            file=sys.stderr,
        )
        return 2

    info = server.info()
    print(f"snapshot {info['snapshot']}  backend {info['backend']}")
    print(f"{info['units']} units ({info['masters']} masters), matrix {info['matrix']}")
    print(f"listening on http://{args.host}:{args.port}/  (forward this port to browse)")
    print("Ctrl-C to stop")

    httpd = ThreadingHTTPServer((args.host, args.port), build_handler(server))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping")
    finally:
        httpd.server_close()
        server.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
