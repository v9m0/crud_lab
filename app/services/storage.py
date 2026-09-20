"""Локальное файловое хранилище.

Единственное место, где происходят операции с диском. Имя файла на диске —
это UUID записи: пользовательский filename в построении пути не участвует,
поэтому выход за пределы каталога через имя невозможен.
"""

import shutil
from pathlib import Path
from typing import BinaryIO

from app.core.exceptions import StorageError


class LocalStorage:
    def __init__(self, root: Path) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def path_for(self, key: str) -> Path:
        return self._root / key

    def save(self, key: str, stream: BinaryIO) -> int:
        """Пишет поток на диск, возвращает размер в байтах."""
        target = self.path_for(key)
        try:
            with target.open("wb") as buffer:
                shutil.copyfileobj(stream, buffer)
            return target.stat().st_size
        except OSError as exc:
            raise StorageError(f"Не удалось сохранить файл: {exc}") from exc

    def remove(self, key: str) -> None:
        try:
            self.path_for(key).unlink(missing_ok=True)
        except OSError as exc:
            raise StorageError(f"Не удалось удалить файл: {exc}") from exc

    def exists(self, key: str) -> bool:
        return self.path_for(key).is_file()
