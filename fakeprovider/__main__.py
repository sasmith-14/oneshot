"""Command-line entry point: ``fakeprovider`` or ``python -m fakeprovider``."""

from __future__ import annotations

import argparse
import os

from fakeprovider.server import ProviderConfig, serve


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="fakeprovider",
        description="Run the fake external provider (charges + messages) with an independent ledger.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("FAKEPROVIDER_PORT", 8701)))
    parser.add_argument("--db", default=os.environ.get("FAKEPROVIDER_DB", "var/provider.db"))
    parser.add_argument(
        "--idempotency-ttl",
        type=float,
        default=24 * 3600,
        help="seconds the provider remembers an Idempotency-Key (default 86400)",
    )
    parser.add_argument("--timeout-hang", type=float, default=5.0, help="seconds a TIMEOUT fault holds the connection")
    parser.add_argument("--slow-delay", type=float, default=3.0, help="seconds a SLOW_SUCCESS fault waits before applying")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    os.makedirs(os.path.dirname(os.path.abspath(args.db)), exist_ok=True)
    serve(
        ProviderConfig(
            db_path=args.db,
            host=args.host,
            port=args.port,
            idempotency_ttl_seconds=args.idempotency_ttl,
            timeout_hang_seconds=args.timeout_hang,
            slow_delay_seconds=args.slow_delay,
            quiet=args.quiet,
        )
    )


if __name__ == "__main__":
    main()
