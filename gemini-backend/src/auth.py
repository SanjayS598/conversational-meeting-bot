from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import Header, HTTPException, status

from .config import settings


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        return ""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return token.strip()


async def require_internal_auth(
    authorization: Annotated[str | None, Header()] = None,
    x_internal_token: Annotated[str | None, Header(alias="x-internal-token")] = None,
) -> None:
    token = _extract_bearer_token(authorization) or (x_internal_token or "").strip()
    expected = settings.internal_service_token

    if not token or not secrets.compare_digest(token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )
