from functools import lru_cache

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_session
from app.repositories.interfaces.file_repo import IFileRepo
from app.repositories.sqlalchemy.file_repo import SqlAlchemyFileRepo
from app.services.file_service import FileService
from app.services.storage import LocalStorage


@lru_cache
def get_storage() -> LocalStorage:
    return LocalStorage(get_settings().storage_dir)


def get_file_repository(session: AsyncSession = Depends(get_session)) -> IFileRepo:
    return SqlAlchemyFileRepo(session)


def get_file_service(
    session: AsyncSession = Depends(get_session),
    repo: IFileRepo = Depends(get_file_repository),
    storage: LocalStorage = Depends(get_storage),
) -> FileService:
    # session.commit нужен сервису, чтобы удалять блоб уже после коммита
    return FileService(repo, storage, session.commit)
