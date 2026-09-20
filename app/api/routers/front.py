from fastapi import APIRouter
from fastapi.responses import FileResponse

from app.core.config import STATIC_DIR

router = APIRouter(include_in_schema=False)


@router.get("/")
async def serve_index() -> FileResponse:
    return FileResponse(STATIC_DIR / "html" / "index.html")
