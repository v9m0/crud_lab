from uuid import UUID

from app.core.exceptions import NotFoundError, ValidationError
from app.db.models import FileRecord
from app.repositories.interfaces.file_repo import IFileRepo
from app.schemas.file import FileCreate, FileReplace

# Поля, которые в БД объявлены NOT NULL. Схема PATCH синтаксически допускает
# для них null, поэтому проверяем явно — иначе получим 500 от базы вместо 400.
NON_NULLABLE_FIELDS = ("filename", "description", "is_public")


class FileService:
    """Бизнес-логика. Про HTTP ничего не знает и fastapi не импортирует."""

    def __init__(self, repo: IFileRepo) -> None:
        self._repo = repo

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
        await self._repo.delete(record)
