import contextlib
import io
import json
import unittest
from unittest.mock import patch

import cloud_db_probe


SAFE_DSN = "postgresql://probe:secret@example.invalid/db?sslmode=require"


class FakeCursor:
    def __init__(self, row=(1,)):
        self.row = row
        self.statement = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, statement):
        self.statement = statement

    def fetchone(self):
        return self.row


class FakeConnection:
    def __init__(self, row=(1,)):
        self.row = row

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def cursor(self):
        return FakeCursor(self.row)


class CloudDatabaseProbeTests(unittest.TestCase):
    def test_missing_database_url_fails_without_connecting(self):
        code, result = cloud_db_probe.run_probe({}, lambda *_a, **_k: self.fail("must not connect"))
        self.assertEqual(code, 2)
        self.assertEqual(result["reason"], "DATABASE_URL_missing")

    def test_tls_is_required(self):
        dsn = "postgresql://probe:secret@example.invalid/db"
        code, result = cloud_db_probe.run_probe({"DATABASE_URL": dsn}, lambda *_a, **_k: self.fail("must not connect"))
        self.assertEqual(code, 2)
        self.assertEqual(result["reason"], "DATABASE_URL_invalid_or_tls_not_required")

    def test_select_one_passes(self):
        captured = {}

        def connect(dsn, **kwargs):
            captured.update(dsn=dsn, kwargs=kwargs)
            return FakeConnection()

        code, result = cloud_db_probe.run_probe({"DATABASE_URL": SAFE_DSN}, connect)
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(all(result["checks"].values()))
        self.assertEqual(captured["kwargs"], {"connect_timeout": 10})

    def test_failure_does_not_disclose_dsn_or_exception_message(self):
        class PrivateFailure(RuntimeError):
            pass

        def connect(*_args, **_kwargs):
            raise PrivateFailure(SAFE_DSN)

        code, result = cloud_db_probe.run_probe({"DATABASE_URL": SAFE_DSN}, connect)
        rendered = json.dumps(result)
        self.assertEqual(code, 1)
        self.assertEqual(result["reason"], "PrivateFailure")
        self.assertNotIn("secret", rendered)
        self.assertNotIn("example.invalid", rendered)

    def test_main_prints_one_json_line(self):
        output = io.StringIO()
        with patch.dict(cloud_db_probe.os.environ, {"DATABASE_URL": ""}, clear=True):
            with contextlib.redirect_stdout(output):
                code = cloud_db_probe.main()
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output.getvalue())["status"], "FAIL")


if __name__ == "__main__":
    unittest.main()
