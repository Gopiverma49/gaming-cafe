import re
from typing import Set, Tuple, Optional
from fastapi import HTTPException, status

# Magic byte signatures
ALLOWED_MAGIC_SIGNATURES = {
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/png": [b"\x89PNG\r\n\x1a\n"],
    "image/webp": [b"RIFF"],  # And "WEBP" at offset 8
    "application/pdf": [b"%PDF-"],
}

MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB


def inspect_magic_bytes(header: bytes) -> Optional[str]:
    """
    Inspects leading bytes of a file buffer to determine its authentic MIME type.
    """
    if len(header) < 12:
        return None

    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image/webp"
    if header.startswith(b"%PDF-"):
        return "application/pdf"

    return None


def validate_upload_buffer(
    content: bytes,
    filename: str,
    allowed_mime_types: Optional[Set[str]] = None,
    max_size: int = MAX_FILE_SIZE_BYTES,
) -> Tuple[bool, str]:
    """
    Validates file upload content against magic byte signatures, strict file-size limits,
    and sanitized alphanumeric filenames to prevent directory traversal and RCE.
    """
    if allowed_mime_types is None:
        allowed_mime_types = {"image/png", "image/jpeg", "image/webp", "application/pdf"}

    # 1. Size check
    if len(content) > max_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum allowed size of {max_size // (1024 * 1024)}MB.",
        )

    if len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File content cannot be empty.",
        )

    # 2. Filename sanitization (no path traversal, alphanumeric + standard extension)
    sanitized_filename = re.sub(r"[^a-zA-Z0-9._-]", "_", filename)
    if ".." in sanitized_filename or sanitized_filename.startswith("/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid filename: potential path traversal detected.",
        )

    # 3. Magic byte MIME verification
    detected_mime = inspect_magic_bytes(content[:16])
    if not detected_mime or detected_mime not in allowed_mime_types:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file format. Detected: {detected_mime or 'unknown'}. Allowed: {', '.join(allowed_mime_types)}",
        )

    return True, sanitized_filename
