from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StringConstraints

# Серверная валидация: длины и запрет служебных символов в имени.
# Паттерн заодно отсекает попытки выйти из каталога через имя файла.
FileName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=255, pattern=r"^[^/\\\x00-\x1f]+$"
    ),
]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]


class FileCreate(BaseModel):
    """Тело POST: описание и публичность необязательны."""

    model_config = ConfigDict(extra="forbid")

    filename: FileName
    description: Description = ""
    is_public: bool = False


class FileReplace(BaseModel):
    """Тело PUT: полная замена, все изменяемые поля обязательны."""

    model_config = ConfigDict(extra="forbid")

    filename: FileName
    description: Description
    is_public: bool


class FilePatch(BaseModel):
    """Тело PATCH: меняется только то, что прислали."""

    model_config = ConfigDict(extra="forbid")

    filename: FileName | None = None
    description: Description | None = None
    is_public: bool | None = None


class FileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    filename: str
    description: str
    size_bytes: int
    is_public: bool
    content_type: str | None
    has_content: bool
    created_at: datetime
    updated_at: datetime


class FileListResponse(BaseModel):
    items: list[FileRead]
    total: int
    limit: int
    offset: int
