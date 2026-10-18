"""``mmindex`` command line interface."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import ALL_STAGES, STAGES, Layout, Settings


def _layout(args: argparse.Namespace) -> Layout:
    return Layout(Path(args.work_dir), namespace=args.namespace)


def _settings(args: argparse.Namespace) -> Settings:
    settings = Settings.from_env()
    if getattr(args, "backend", None):
        settings.backend = args.backend
    return settings


def _print(payload: object) -> None:
    print(json.dumps(payload, indent=2, default=str))


def cmd_scan(args: argparse.Namespace) -> int:
    from .pipeline import Pipeline

    pipeline = Pipeline(_layout(args), _settings(args))
    try:
        summary = pipeline.run_scan(args.media_root, exclude=args.exclude or ())
    finally:
        pipeline.close()
    _print(summary)
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    from .pipeline import Pipeline

    pipeline = Pipeline(_layout(args), _settings(args))
    stages = args.stages or list(ALL_STAGES)
    try:
        results = pipeline.run_all(
            args.media_root, stages=stages, exclude=args.exclude or (), skip_scan=args.skip_scan
        )
    finally:
        pipeline.close()
    _print(_summarise(results))
    return 0


def cmd_stage(args: argparse.Namespace) -> int:
    from .pipeline import Pipeline

    pipeline = Pipeline(_layout(args), _settings(args))
    try:
        if args.stage == "cluster":
            result = pipeline.run_cluster()
        elif args.stage == "export":
            result = pipeline.run_export()
        else:
            result = pipeline.run_stage(args.stage)
    finally:
        pipeline.close()
    _print(_summarise(result))
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    from .backends import build_backend
    from .search import Index

    layout = _layout(args)
    settings = _settings(args)
    index = Index.open(layout, settings)
    vector = None
    if args.query:
        backend = build_backend(settings)
        try:
            vector = backend.embed_text(args.query)
        finally:
            backend.close()
    hits = index.search(
        vector,
        text=args.query,
        limit=args.limit,
        person_id=args.person,
        min_faces=args.min_faces,
        include_non_master=args.include_non_master,
    )
    _print([hit.to_dict() for hit in hits])
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    from .export import read_manifest, verify_snapshot

    layout = _layout(args)
    manifest = read_manifest(layout)
    if not manifest:
        _print({"ok": False, "errors": ["no index_manifest.json"]})
        return 1
    checks = verify_snapshot(
        Path(manifest["snapshot_dir"]),
        manifest["unit_count"],
        manifest["settings"]["clip_embedding_dim"],
    )
    _print({"manifest": manifest, "checks": checks})
    return 0 if checks["ok"] else 1


def cmd_worker(args: argparse.Namespace) -> int:
    from .worker import Worker

    settings = _settings(args)
    worker = Worker(
        args.stage,
        _layout(args),
        settings,
        lease_seconds=args.lease,
        shard=args.shard,
        max_tasks=args.max_tasks,
    )
    _print(worker.run())
    return 0


def cmd_coordinator(args: argparse.Namespace) -> int:
    from .coordinator import Coordinator

    coordinator = Coordinator(
        _layout(args), _settings(args), poll_interval=args.poll_interval, lease_seconds=args.lease
    )
    try:
        results = coordinator.run(args.stages or list(ALL_STAGES), timeout=args.timeout)
    finally:
        coordinator.close()
    _print(_summarise(results))
    return 0


def cmd_queue(args: argparse.Namespace) -> int:
    from .queue import WorkQueue

    queue = WorkQueue(_layout(args).queue_db)
    try:
        if args.queue_action == "stats":
            _print(queue.stats(args.stage))
        elif args.queue_action == "retry":
            _print({"retried": queue.retry_failed(args.stage)})
        elif args.queue_action == "reclaim":
            _print({"reclaimed": queue.reclaim_stale(args.lease)})
        elif args.queue_action == "failures":
            _print(queue.failures(args.stage))
    finally:
        queue.close()
    return 0


def _summarise(result):
    if isinstance(result, dict):
        return {
            key: (
                {
                    "done": value.get("done"),
                    "skipped": value.get("skipped"),
                    "failed": len(value.get("failed") or []),
                }
                if isinstance(value, dict) and "done" in value
                else value
            )
            for key, value in result.items()
        }
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mmindex", description="Multimodal media indexer (CPU port)"
    )
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--work-dir", default="./index_work", help="index working directory")
    common.add_argument("--namespace", default="default", help="checkpoint namespace")
    common.add_argument(
        "--backend", default=None, choices=["auto", "ml", "hash"], help="inference backend"
    )

    sub = parser.add_subparsers(dest="command", required=True)

    scan = sub.add_parser("scan", parents=[common], help="build the media manifest")
    scan.add_argument("media_root")
    scan.add_argument("--exclude", action="append", help="paths to skip")
    scan.set_defaults(func=cmd_scan)

    run = sub.add_parser("run", parents=[common], help="run the full pipeline")
    run.add_argument("media_root")
    run.add_argument("--stages", nargs="+", choices=list(ALL_STAGES))
    run.add_argument("--exclude", action="append")
    run.add_argument("--skip-scan", action="store_true")
    run.set_defaults(func=cmd_run)

    stage = sub.add_parser("stage", parents=[common], help="run one stage")
    stage.add_argument("stage", choices=list(ALL_STAGES))
    stage.set_defaults(func=cmd_stage)

    search = sub.add_parser("search", parents=[common], help="query the published index")
    search.add_argument("query", nargs="?", default="")
    search.add_argument("--limit", type=int, default=20)
    search.add_argument("--person", default=None)
    search.add_argument("--min-faces", type=int, default=0)
    search.add_argument("--include-non-master", action="store_true")
    search.set_defaults(func=cmd_search)

    verify = sub.add_parser("verify", parents=[common], help="verify the active snapshot")
    verify.set_defaults(func=cmd_verify)

    worker = sub.add_parser("worker", parents=[common], help="run a spot worker loop")
    worker.add_argument("--stage", required=True, choices=list(STAGES))
    worker.add_argument("--lease", type=float, default=300.0)
    worker.add_argument("--shard", type=int, default=None)
    worker.add_argument("--max-tasks", type=int, default=None)
    worker.set_defaults(func=cmd_worker)

    coordinator = sub.add_parser("coordinator", parents=[common], help="drive all stages")
    coordinator.add_argument("--stages", nargs="+")
    coordinator.add_argument("--poll-interval", type=float, default=5.0)
    coordinator.add_argument("--lease", type=float, default=300.0)
    coordinator.add_argument("--timeout", type=float, default=None)
    coordinator.set_defaults(func=cmd_coordinator)

    queue = sub.add_parser("queue", parents=[common], help="inspect the work queue")
    queue.add_argument("queue_action", choices=["stats", "retry", "reclaim", "failures"])
    queue.add_argument("--stage", default=None)
    queue.add_argument("--lease", type=float, default=300.0)
    queue.set_defaults(func=cmd_queue)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"error: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
