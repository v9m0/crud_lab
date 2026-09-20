from uuid import UUID

from fastapi import APIRouter
from fastapi.responses import FileResponse

from app.core.config import STATIC_DIR

router = APIRouter(include_in_schema=False)


@router.get("/")
async def serve_index() -> FileResponse:
    return FileResponse(STATIC_DIR / "html" / "index.html")


@router.get("/files/{file_id}")
async def serve_detail(file_id: UUID) -> FileResponse:
    """Страница одной записи. Данные подтягивает сам клиент по /api/files/{id}."""
    return FileResponse(STATIC_DIR / "html" / "detail.html")
