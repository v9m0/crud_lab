from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import get_file_service
from app.schemas.errors import ERROR_RESPONSES
from app.schemas.file import (
    FileCreate,
    FileListResponse,
    FilePatch,
    FileRead,
    FileReplace,
)
from app.services.file_service import FileService

router = APIRouter(prefix="/api/files", tags=["files"], responses=ERROR_RESPONSES)


@router.get("", response_model=FileListResponse, summary="Список записей")
async def list_files(
    is_public: bool | None = Query(None, description="Фильтр по публичности"),
    q: str | None = Query(None, max_length=255, description="Поиск по имени и описанию"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    service: FileService = Depends(get_file_service),
) -> FileListResponse:
    items, total = await service.list_files(
        is_public=is_public, query=q, limit=limit, offset=offset
    )
    return FileListResponse(
        items=[FileRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{file_id}", response_model=FileRead, summary="Одна запись")
async def get_file(
    file_id: UUID, service: FileService = Depends(get_file_service)
) -> FileRead:
    return FileRead.model_validate(await service.get_file(file_id))


@router.post(
    "",
    response_model=FileRead,
    status_code=status.HTTP_201_CREATED,
    summary="Создать запись",
)
async def create_file(
    payload: FileCreate,
    response: Response,
    service: FileService = Depends(get_file_service),
) -> FileRead:
    record = await service.create_file(payload)
    response.headers["Location"] = f"/api/files/{record.id}"
    return FileRead.model_validate(record)


@router.put("/{file_id}", response_model=FileRead, summary="Заменить запись целиком")
async def replace_file(
    file_id: UUID,
    payload: FileReplace,
    service: FileService = Depends(get_file_service),
) -> FileRead:
    return FileRead.model_validate(await service.replace_file(file_id, payload))


@router.patch("/{file_id}", response_model=FileRead, summary="Изменить отдельные поля")
async def patch_file(
    file_id: UUID,
    payload: FilePatch,
    service: FileService = Depends(get_file_service),
) -> FileRead:
    changes = payload.model_dump(exclude_unset=True)
    return FileRead.model_validate(await service.patch_file(file_id, changes))


@router.delete(
    "/{file_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Удалить запись",
)
async def delete_file(
    file_id: UUID, service: FileService = Depends(get_file_service)
) -> Response:
    await service.delete_file(file_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
