from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse

from app.api.deps import get_file_service
from app.schemas.errors import ERROR_RESPONSES
from app.schemas.file import FileRead
from app.services.file_service import FileService

router = APIRouter(prefix="/api/files", tags=["files-content"], responses=ERROR_RESPONSES)


@router.put(
    "/{file_id}/content",
    response_model=FileRead,
    summary="Загрузить содержимое файла",
    description=(
        "PUT, а не POST: повторная загрузка заменяет содержимое, "
        "а не создаёт вторую копию."
    ),
)
async def upload_content(
    file_id: UUID,
    file: UploadFile = File(...),
    service: FileService = Depends(get_file_service),
) -> FileRead:
    record = await service.save_content(file_id, file.file, file.content_type)
    return FileRead.model_validate(record)


@router.get(
    "/{file_id}/content",
    response_class=FileResponse,
    summary="Скачать содержимое файла",
)
async def download_content(
    file_id: UUID, service: FileService = Depends(get_file_service)
) -> FileResponse:
    path, filename, media_type = await service.get_content(file_id)
    return FileResponse(path=path, filename=filename, media_type=media_type)
