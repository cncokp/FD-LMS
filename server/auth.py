"""
FD-LMS Admin Portal Authentication Module
Supports session cookies (HttpOnly) and Bearer token headers.
"""

import os
import time
import hmac
import hashlib
import base64
from typing import Optional, Dict, Any
from fastapi import Request, HTTPException, status
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin").strip()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123").strip()
ADMIN_SECRET_KEY = os.getenv("ADMIN_SECRET_KEY", "fd-lms-super-secret-admin-key-2026").strip()
TOKEN_EXPIRY_SECONDS = 86400 * 7  # 7 days session validity


def verify_credentials(username: str, password: str) -> bool:
    if not username or not password:
        return False
    user_ok = hmac.compare_digest(username.strip(), ADMIN_USERNAME)
    pass_ok = hmac.compare_digest(password.strip(), ADMIN_PASSWORD)
    return user_ok and pass_ok


def create_access_token(username: str) -> str:
    expires_at = int(time.time()) + TOKEN_EXPIRY_SECONDS
    payload_str = f"{username}:{expires_at}"
    sig = hmac.new(
        ADMIN_SECRET_KEY.encode("utf-8"),
        payload_str.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    raw_token = f"{payload_str}:{sig}"
    return base64.urlsafe_b64encode(raw_token.encode("utf-8")).decode("utf-8")


def verify_token(token_str: str) -> Optional[Dict[str, Any]]:
    if not token_str:
        return None
    try:
        raw_token = base64.urlsafe_b64decode(token_str.encode("utf-8")).decode("utf-8")
        parts = raw_token.split(":")
        if len(parts) != 3:
            return None
        username, expires_at_str, sig = parts
        expires_at = int(expires_at_str)
        if time.time() > expires_at:
            return None
        payload_str = f"{username}:{expires_at}"
        expected_sig = hmac.new(
            ADMIN_SECRET_KEY.encode("utf-8"),
            payload_str.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        return {"username": username, "expires_at": expires_at}
    except Exception:
        return None


async def get_current_admin(request: Request) -> Dict[str, Any]:
    token = request.cookies.get("fd_admin_session")

    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )

    user = verify_token(token)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session"
        )
    return user
