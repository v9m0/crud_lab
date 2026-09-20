from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.repositories.interfaces.file_repo import IFileRepo
from app.repositories.sqlalchemy.file_repo import SqlAlchemyFileRepo
from app.services.file_service import FileService


def get_file_repository(session: AsyncSession = Depends(get_session)) -> IFileRepo:
    return SqlAlchemyFileRepo(session)


def get_file_service(repo: IFileRepo = Depends(get_file_repository)) -> FileService:
    return FileService(repo)
