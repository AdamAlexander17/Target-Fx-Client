"""Bounded five-minute capabilities for locally generated bill PDFs/ZIPs.

No broker JWT, bot token, or broker identity is stored in these files/URLs.
Keep this directory private: downloads must pass through the expiry check.
"""
from __future__ import annotations

import re
import secrets
import threading
import time
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

FILES_DIR = Path(__file__).resolve().parent.parent / "files" / "bill-downloads"
TTL_SECONDS = 300
MAX_BYTES = 25 * 1024 * 1024
MAX_STORAGE_BYTES = 250 * 1024 * 1024
_guard = threading.Lock()
_TOKEN = re.compile(r"^[a-f0-9]{64}$")


def _filename(value: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", value).strip(". ")
    if not name.lower().endswith((".pdf", ".zip")):
        raise HTTPException(400, "Only PDF and ZIP bill downloads are supported")
    return name[:-4][:176] + name[-4:]


def _cleanup() -> int:
    """Called under the write lock; expiry is also enforced on every GET."""
    FILES_DIR.mkdir(parents=True, exist_ok=True)
    used = 0
    for path in FILES_DIR.iterdir():
        if path.is_file():
            try:
                stat = path.stat()
                if stat.st_mtime <= time.time() - TTL_SECONDS:
                    path.unlink(missing_ok=True)
                else:
                    used += stat.st_size
            except FileNotFoundError:
                pass
    return used


def create_router(get_session: Callable) -> APIRouter:
    router = APIRouter()

    @router.post("/ai/bill-downloads")
    async def prepare(request: Request, filename: str, session=Depends(get_session)):
        # Authenticate before consuming bytes. Stream with a hard bound even without Content-Length.
        name = _filename(filename)
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > MAX_BYTES:
                raise HTTPException(413, "Bill download exceeds 25 MB")
            data.extend(chunk)
        valid = data.startswith(b"%PDF-") if name.lower().endswith(".pdf") else data.startswith(b"PK\x03\x04")
        if not valid:
            raise HTTPException(400, "Invalid PDF or ZIP bill")
        with _guard:
            used = _cleanup()
            if used + len(data) > MAX_STORAGE_BYTES:
                raise HTTPException(429, "Bill download storage is busy; retry in five minutes")
            token = secrets.token_hex(32)
            path = FILES_DIR / token
            try:
                with path.open("xb") as output:
                    output.write(data)
            except OSError:
                path.unlink(missing_ok=True)
                raise HTTPException(503, "Bill download storage unavailable") from None
        return JSONResponse({"token": token, "expires_in": TTL_SECONDS}, headers={"Cache-Control": "no-store"})

    @router.get("/ai/bill-downloads/{token}/{filename}")
    def download(token: str, filename: str):
        if not _TOKEN.fullmatch(token):
            raise HTTPException(404, "Download expired or not found")
        name = _filename(filename)
        path = FILES_DIR / token
        try:
            if path.stat().st_mtime <= time.time() - TTL_SECONDS:
                path.unlink(missing_ok=True)
                raise HTTPException(404, "Download expired or not found")
            # Derive media type from the stored bytes, not a caller-controlled extension.
            with path.open("rb") as source:
                pdf = source.read(5) == b"%PDF-"
        except FileNotFoundError:
            raise HTTPException(404, "Download expired or not found") from None
        if pdf != name.lower().endswith(".pdf"):
            raise HTTPException(400, "File extension does not match bill")
        return FileResponse(path, filename=name, media_type="application/pdf" if pdf else "application/zip",
                            headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
                                     "X-Content-Type-Options": "nosniff",
                                     "Access-Control-Allow-Origin": "https://web.telegram.org"})

    return router