from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import FileRecord


class SqlAlchemyFileRepo:
    """Репозиторий не бросает доменных исключений — возвращает None или пустой список."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list(
        self, *, is_public: bool | None, query: str | None, limit: int, offset: int
    ) -> tuple[list[FileRecord], int]:
        conditions = []
        if is_public is not None:
            conditions.append(FileRecord.is_public.is_(is_public))
        if query:
            pattern = f"%{query}%"
            conditions.append(
                or_(
                    FileRecord.filename.ilike(pattern),
                    FileRecord.description.ilike(pattern),
                )
            )

        total = await self._session.scalar(
            select(func.count()).select_from(FileRecord).where(*conditions)
        )
        rows = await self._session.scalars(
            select(FileRecord)
            .where(*conditions)
            .order_by(FileRecord.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(rows.all()), int(total or 0)

    async def get(self, file_id: UUID) -> FileRecord | None:
        return await self._session.get(FileRecord, file_id)

    async def add(self, record: FileRecord) -> FileRecord:
        self._session.add(record)
        await self._session.flush()
        return record

    async def delete(self, record: FileRecord) -> None:
        await self._session.delete(record)
        await self._session.flush()

    async def flush(self) -> None:
        await self._session.flush()
