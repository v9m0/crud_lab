from typing import Protocol
from uuid import UUID

from app.db.models import FileRecord


class IFileRepo(Protocol):
    """Контракт хранилища. Реализацию можно подменить, не трогая сервис."""

    async def list(
        self, *, is_public: bool | None, query: str | None, limit: int, offset: int
    ) -> tuple[list[FileRecord], int]: ...

    async def get(self, file_id: UUID) -> FileRecord | None: ...

    async def add(self, record: FileRecord) -> FileRecord: ...

    async def delete(self, record: FileRecord) -> None: ...

    async def flush(self) -> None: ...
