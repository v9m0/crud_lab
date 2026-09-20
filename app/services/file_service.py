import asyncio
from pathlib import Path
from typing import BinaryIO
from uuid import UUID

from app.core.exceptions import NotFoundError, ValidationError
from app.db.models import FileRecord
from app.repositories.interfaces.file_repo import IFileRepo
from app.services.storage import LocalStorage
from app.schemas.file import FileCreate, FileReplace

# Поля, которые в БД объявлены NOT NULL. Схема PATCH синтаксически допускает
# для них null, поэтому проверяем явно — иначе получим 500 от базы вместо 400.
NON_NULLABLE_FIELDS = ("filename", "description", "is_public")


class FileService:
    """Бизнес-логика. Про HTTP ничего не знает и fastapi не импортирует."""

    def __init__(self, repo: IFileRepo, storage: LocalStorage, commit) -> None:
        self._repo = repo
        self._storage = storage
        self._commit = commit

    async def list_files(
        self, *, is_public: bool | None, query: str | None, limit: int, offset: int
    ) -> tuple[list[FileRecord], int]:
        return await self._repo.list(
            is_public=is_public, query=query, limit=limit, offset=offset
        )

    async def get_file(self, file_id: UUID) -> FileRecord:
        record = await self._repo.get(file_id)
        if record is None:
            raise NotFoundError("File not found")
        return record

    async def create_file(self, data: FileCreate) -> FileRecord:
        return await self._repo.add(FileRecord(**data.model_dump()))

    async def replace_file(self, file_id: UUID, data: FileReplace) -> FileRecord:
        """PUT: заменяет все изменяемые клиентом поля.

        Серверные поля (size_bytes, content_type, created_at) и содержимое
        файла не затрагиваются.
        """
        record = await self.get_file(file_id)
        for field, value in data.model_dump().items():
            setattr(record, field, value)
        await self._repo.flush()
        return record

    async def patch_file(self, file_id: UUID, changes: dict) -> FileRecord:
        """PATCH: меняет только присланные поля."""
        if not changes:
            raise ValidationError(details=["body: at least one field must be provided"])

        nulls = [
            field
            for field, value in changes.items()
            if field in NON_NULLABLE_FIELDS and value is None
        ]
        if nulls:
            raise ValidationError(details=[f"{field}: must not be null" for field in nulls])

        record = await self.get_file(file_id)
        for field, value in changes.items():
            setattr(record, field, value)
        await self._repo.flush()
        return record

    async def delete_file(self, file_id: UUID) -> None:
        record = await self.get_file(file_id)
        storage_key = record.storage_key
        await self._repo.delete(record)

        # Блоб удаляем только после коммита: если транзакция откатится,
        # запись в БД останется, а файла на диске уже не будет.
        await self._commit()
        if storage_key:
            await asyncio.to_thread(self._storage.remove, storage_key)

    async def save_content(
        self, file_id: UUID, stream: BinaryIO, content_type: str | None
    ) -> FileRecord:
        """Загрузка содержимого. Повторный вызов заменяет предыдущее."""
        record = await self.get_file(file_id)
        storage_key = str(record.id)

        size = await asyncio.to_thread(self._storage.save, storage_key, stream)

        record.storage_key = storage_key
        record.size_bytes = size
        record.content_type = content_type or "application/octet-stream"
        await self._repo.flush()
        return record

    async def get_content(self, file_id: UUID) -> tuple[Path, str, str]:
        """Путь к блобу, имя для скачивания и тип содержимого."""
        record = await self.get_file(file_id)
        if not record.storage_key or not self._storage.exists(record.storage_key):
            raise NotFoundError("File content has not been uploaded")
        return (
            self._storage.path_for(record.storage_key),
            record.filename,
            record.content_type or "application/octet-stream",
        )
