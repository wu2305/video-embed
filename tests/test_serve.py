"""The query console: routes, filters, media streaming and error handling.

The server is exercised through its real HTTP handler on a loopback socket, so
these tests cover the request parsing and the range logic that a browser
depends on, not just the underlying `Index` calls.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from mmindex.config import Layout, Settings
from mmindex.pipeline import Pipeline

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"


def _load_serve():
    """Import ``scripts/serve.py`` as a module (``scripts`` is not a package)."""
    spec = importlib.util.spec_from_file_location("mmindex_serve", SCRIPTS / "serve.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def served(tmp_path):
    """A built index plus a running console on an ephemeral port."""
    from http.server import ThreadingHTTPServer

    serve = _load_serve()
    Server, build_handler = serve.Server, serve.build_handler

    media = tmp_path / "media"
    media.mkdir()
    rng = np.random.default_rng(3)
    for index in range(4):
        array = (rng.random((48, 64, 3)) * 255).astype("uint8")
        Image.fromarray(array).save(media / f"frame_{index}.png")

    layout = Layout(tmp_path / "work")
    settings = Settings()
    settings.backend = "hash"
    pipeline = Pipeline(layout, settings, log=lambda _m: None)
    try:
        pipeline.run_all(media)
    finally:
        pipeline.close()

    server = Server(layout, settings, "hash")
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), build_handler(server))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    try:
        yield base, media
    finally:
        httpd.shutdown()
        httpd.server_close()
        server.close()
        thread.join(timeout=5)


def _get(base: str, path: str, headers: dict | None = None):
    request = urllib.request.Request(base + path, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()


def _json(base: str, path: str):
    status, _headers, body = _get(base, path)
    return status, json.loads(body)


def test_page_is_served(served):
    base, _media = served
    status, headers, body = _get(base, "/")
    assert status == 200
    assert headers["Content-Type"].startswith("text/html")
    assert b"query console" in body
    # The page must not inline any remote asset: it has to work in a container
    # with no outbound network.
    assert b"http://" not in body.split(b"<script>")[0].lower()


def test_info_reports_the_snapshot(served):
    base, _media = served
    status, info = _json(base, "/api/info")
    assert status == 200
    assert info["backend"] == "hash"
    assert info["units"] == 4
    assert info["masters"] == 4
    assert info["matrix"][1] == 768
    assert info["text_bonus"] == 0.15


def test_search_returns_ranked_hits_with_timings(served):
    base, _media = served
    status, payload = _json(base, "/api/search?q=frame&limit=3")
    assert status == 200
    assert len(payload["hits"]) == 3
    scores = [hit["score"] for hit in payload["hits"]]
    assert scores == sorted(scores, reverse=True)
    assert payload["query_dims"] == 768
    assert set(payload["timing"]) == {"embed_ms", "rank_ms", "total_ms"}
    assert payload["timing"]["total_ms"] >= 0


def test_search_limit_is_clamped(served):
    base, _media = served
    _status, payload = _json(base, "/api/search?q=frame&limit=999")
    assert len(payload["hits"]) == 4  # all units, not 999
    _status, payload = _json(base, "/api/search?q=frame&limit=0")
    assert len(payload["hits"]) == 1  # clamped up to 1


def test_search_filters_are_applied(served):
    base, _media = served
    _status, payload = _json(base, "/api/search?q=frame&limit=10&min_score=0.05")
    assert all(hit["score"] >= 0.05 for hit in payload["hits"])
    _status, payload = _json(base, "/api/search?q=frame&limit=10&person=person-9999")
    assert payload["hits"] == []


def test_search_rejects_missing_and_bad_parameters(served):
    base, _media = served
    status, payload = _json(base, "/api/search?q=")
    assert status == 400 and "missing q" in payload["error"]
    status, payload = _json(base, "/api/search?q=x&limit=abc")
    assert status == 400 and "limit" in payload["error"]
    status, payload = _json(base, "/api/search?q=x&min_score=abc")
    assert status == 400 and "min_score" in payload["error"]


def test_thumbnail_is_a_bounded_jpeg(served):
    base, _media = served
    _status, hits = _json(base, "/api/search?q=frame&limit=1")
    unit_id = hits["hits"][0]["unit_id"]
    status, headers, body = _get(base, f"/api/thumb?id={unit_id}")
    assert status == 200
    assert headers["Content-Type"] == "image/jpeg"
    assert body[:2] == b"\xff\xd8"  # JPEG SOI


def test_thumbnail_rejects_unknown_and_malformed_ids(served):
    base, _media = served
    status, _headers, body = _get(base, "/api/thumb?id=99999")
    assert status == 404
    assert b"no thumbnail" in body
    status, _headers, body = _get(base, "/api/thumb?id=abc")
    assert status == 400
    status, _headers, body = _get(base, "/api/thumb")
    assert status == 400


def test_thumbnail_refuses_a_path_outside_the_index(served, tmp_path):
    """Only paths present in `units` are opened, so the endpoint cannot read
    arbitrary files from the container."""
    base, _media = served
    secret = tmp_path / "secret.png"
    Image.fromarray(np.zeros((8, 8, 3), dtype=np.uint8)).save(secret)
    status, _headers, _body = _get(base, "/api/thumb?id=0")
    # unit 0 is a real indexed file; the secret was never indexed, so there is
    # no id that maps to it.
    assert status in (200, 404)
    status, _headers, _body = _get(base, f"/api/thumb?id={secret.stat().st_size}")
    assert status == 404


def test_source_streams_with_range_support(served):
    """Browsers refuse to play a video without 206 responses."""
    base, _media = served
    _status, hits = _json(base, "/api/search?q=frame&limit=1")
    unit_id = hits["hits"][0]["unit_id"]

    status, headers, body = _get(base, f"/api/source?id={unit_id}")
    assert status == 200
    assert headers["Accept-Ranges"] == "bytes"
    total = int(headers["Content-Length"])
    assert len(body) == total

    status, headers, body = _get(
        base, f"/api/source?id={unit_id}", headers={"Range": "bytes=0-99"}
    )
    assert status == 206
    assert headers["Content-Range"] == f"bytes 0-99/{total}"
    assert len(body) == 100
    assert body == _get(base, f"/api/source?id={unit_id}")[2][:100]

    status, headers, body = _get(
        base, f"/api/source?id={unit_id}", headers={"Range": "bytes=-40"}
    )
    assert status == 206
    assert len(body) == 40
    assert headers["Content-Range"] == f"bytes {total - 40}-{total - 1}/{total}"

    status, headers, _body = _get(
        base, f"/api/source?id={unit_id}", headers={"Range": f"bytes={total + 10}-"}
    )
    assert status == 416
    assert headers["Content-Range"] == f"bytes */{total}"


def test_source_handles_a_malformed_range(served):
    base, _media = served
    _status, hits = _json(base, "/api/search?q=frame&limit=1")
    unit_id = hits["hits"][0]["unit_id"]
    status, _headers, body = _get(
        base, f"/api/source?id={unit_id}", headers={"Range": "bytes=not-a-range"}
    )
    # Falls back to the whole file rather than failing the request.
    assert status == 200
    assert len(body) > 0


def test_unknown_route_is_404(served):
    base, _media = served
    status, _headers, body = _get(base, "/api/nope")
    assert status == 404
    assert b"no route" in body
