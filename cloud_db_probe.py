#!/usr/bin/env python3
"""Minimal Neon/PostgreSQL connectivity probe without secret disclosure."""

from __future__ import annotations

import json
import os
from typing import Any, Callable, Mapping
from urllib.parse import parse_qs, urlsplit


ConnectFactory = Callable[..., Any]


def _result(status: str, checks: dict[str, bool], reason: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"status": status, "checks": checks}
    if reason:
        result["reason"] = reason
    return result


def _validate_database_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
        return False
    sslmode = parse_qs(parsed.query).get("sslmode", [""])[-1]
    return sslmode in {"require", "verify-ca", "verify-full"}


def run_probe(
    environ: Mapping[str, str] | None = None,
    connect_factory: ConnectFactory | None = None,
) -> tuple[int, dict[str, Any]]:
    env = os.environ if environ is None else environ
    database_url = env.get("DATABASE_URL", "").strip()
    checks = {
        "database_url_present": bool(database_url),
        "tls_required": False,
        "connected": False,
        "select_1": False,
    }
    if not database_url:
        return 2, _result("FAIL", checks, "DATABASE_URL_missing")
    if not _validate_database_url(database_url):
        return 2, _result("FAIL", checks, "DATABASE_URL_invalid_or_tls_not_required")
    checks["tls_required"] = True

    if connect_factory is None:
        try:
            import psycopg
        except ImportError:
            return 2, _result("FAIL", checks, "psycopg_not_installed")
        connect_factory = psycopg.connect

    try:
        with connect_factory(database_url, connect_timeout=10) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                checks["connected"] = True
                checks["select_1"] = cursor.fetchone() == (1,)
    except Exception as error:  # Deliberately exclude the exception message: it may contain the DSN.
        return 1, _result("FAIL", checks, error.__class__.__name__)

    if not checks["select_1"]:
        return 1, _result("FAIL", checks, "unexpected_query_result")
    return 0, _result("PASS", checks)


def main() -> int:
    exit_code, result = run_probe()
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
