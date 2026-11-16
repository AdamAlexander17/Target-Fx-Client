"""Isolated relay tests: no BrokerEye credentials, DB, model or bot required."""
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

from brokereye_ai import bill_downloads as relay


def session(authorization: str = Header(default="")):
    if authorization != "Bearer synthetic-session":
        raise HTTPException(401, "Broker bearer token required")
    return {"broker_id": 14}


class BillDownloadsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.patch = patch.object(relay, "FILES_DIR", self.directory)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        app = FastAPI()
        app.include_router(relay.create_router(session))
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def prepare(self, name="bill.pdf", data=b"%PDF-test"):
        return self.client.post("/ai/bill-downloads", params={"filename": name}, content=data,
                                headers={"Authorization": "Bearer synthetic-session"})

    def test_auth_required_before_upload_and_no_secrets_in_response(self):
        response = self.client.post("/ai/bill-downloads?filename=bill.pdf", content=b"%PDF-test")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(list(self.directory.iterdir()), [])
        response = self.prepare()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["expires_in"], 300)
        self.assertRegex(response.json()["token"], r"^[a-f0-9]{64}$")
        self.assertNotIn("synthetic-session", response.text)

    def test_pdf_and_zip_download_have_native_download_headers(self):
        for name, data, mime in (("bill.pdf", b"%PDF-test", "application/pdf"),
                                 ("bills.zip", b"PK\x03\x04test", "application/zip")):
            token = self.prepare(name, data).json()["token"]
            response = self.client.get(f"/ai/bill-downloads/{token}/{name}")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, data)
            self.assertEqual(response.headers["content-type"], mime)
            self.assertIn("attachment", response.headers["content-disposition"])
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(response.headers["access-control-allow-origin"], "https://web.telegram.org")
            # Native clients may fetch a capability more than once (range/retry).
            self.assertEqual(self.client.get(f"/ai/bill-downloads/{token}/{name}").status_code, 200)

    def test_expired_unknown_and_invalid_capabilities_fail(self):
        token = self.prepare().json()["token"]
        old = time.time() - relay.TTL_SECONDS - 1
        os.utime(self.directory / token, (old, old))
        for candidate in (token, "a" * 64, "not-a-token"):
            self.assertEqual(self.client.get(f"/ai/bill-downloads/{candidate}/bill.pdf").status_code, 404)
        self.assertFalse((self.directory / token).exists())

    def test_size_quota_format_and_extension_are_checked(self):
        self.assertEqual(self.prepare("bill.html", b"<html>").status_code, 400)
        self.assertEqual(self.prepare("bill.pdf", b"<html>").status_code, 400)
        self.assertEqual(self.prepare("bill.zip", b"%PDF-test").status_code, 400)
        with patch.object(relay, "MAX_BYTES", 8):
            self.assertEqual(self.prepare().status_code, 413)
        with patch.object(relay, "MAX_STORAGE_BYTES", 1):
            self.assertEqual(self.prepare().status_code, 429)
        token = self.prepare().json()["token"]
        self.assertEqual(self.client.get(f"/ai/bill-downloads/{token}/bill.zip").status_code, 400)
        response = self.client.get(f"/ai/bill-downloads/{token}/unsafe%22%0D%0Aname.pdf")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("\r", response.headers["content-disposition"])

    def test_cleanup_reclaims_expired_storage_and_long_names_preserve_extension(self):
        old = self.directory / ("b" * 64)
        old.write_bytes(b"old")
        expired = time.time() - 301
        os.utime(old, (expired, expired))
        response = self.prepare("long" * 80 + ".pdf")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(old.exists())
        self.assertTrue(relay._filename("long" * 80 + ".pdf").endswith(".pdf"))


if __name__ == "__main__":
    unittest.main()