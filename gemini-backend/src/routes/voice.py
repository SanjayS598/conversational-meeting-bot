"""
FastAPI router for voice / conversational-agent preparation.

POST /voice/prepare
  Upload documents (PDF, PPTX, TXT, MD) and personal notes.
  Returns prep_id, greeting text, doc names, and context length.
  The prep_id is passed through to /brain/sessions/{id}/start so the
  conversational AI can load the pre-built context immediately on session start.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from ..voice.extractor import extract_text
from ..voice.preloader import prepare

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voice", tags=["voice"])


class PrepareResponse(BaseModel):
    prep_id: str
    greeting: str
    docs: list[str]
    context_length: int


@router.post("/prepare", response_model=PrepareResponse)
async def prepare_agent(
    display_name: Annotated[str, Form()],
    personal_notes: Annotated[str, Form()] = "",
    provider_voice_id: Annotated[str | None, Form()] = None,
    files: Annotated[list[UploadFile], File()] = [],
) -> PrepareResponse:
    """
    Upload context files and build agent preparation package.

    Accepts multipart/form-data with:
    - display_name: name the agent will use in the meeting
    - personal_notes: free-text background / talking points
    - files: zero or more PDF / PPTX / TXT / MD documents

    Returns a prep_id that should be passed to /brain/sessions/{id}/start
    so the conversational AI loads the right context.
    """
    if not display_name.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="display_name is required",
        )

    documents: list[tuple[str, str]] = []
    for upload in files:
        if not upload.filename:
            continue
        filename = upload.filename

        # Gate on allowed extensions (security: never execute uploaded content)
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if ext not in {"pdf", "pptx", "ppt", "txt", "md"}:
            logger.warning("Skipping unsupported file type: %s", filename)
            continue

        content = await upload.read()
        if len(content) > 20 * 1024 * 1024:  # 20 MB hard limit per file
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File {filename} exceeds 20 MB limit",
            )

        try:
            text = await asyncio.get_event_loop().run_in_executor(
                None, extract_text, filename, content
            )
            if text.strip():
                documents.append((filename, text))
        except RuntimeError as exc:
            logger.error("Text extraction failed for %s: %s", filename, exc)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Could not extract text from {filename}: {exc}",
            ) from exc

    result = await prepare(
        display_name=display_name.strip(),
        personal_notes=personal_notes,
        documents=documents,
        provider_voice_id=provider_voice_id,
    )

    return PrepareResponse(
        prep_id=result.prep_id,
        greeting=result.greeting,
        docs=result.docs,
        context_length=result.context_length,
    )
