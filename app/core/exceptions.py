"""Доменные исключения.

Сервисы бросают только их и ничего не знают про HTTP. Перевод в коды ответов
живёт в app/api/errors.py. Благодаря этому невозможен старый баг, когда
`except Exception` перехватывал собственный HTTPException и превращал 404 в 500.
"""


class AppError(Exception):
    status_code: int = 500
    message: str = "Internal server error"

    def __init__(self, message: str | None = None, details: list[str] | None = None) -> None:
        self.message = message or type(self).message
        self.details = details or []
        super().__init__(self.message)


class NotFoundError(AppError):
    status_code = 404
    message = "Resource not found"


class BadRequestError(AppError):
    status_code = 400
    message = "Bad request"


class ValidationError(BadRequestError):
    message = "Validation failed"


class StorageError(AppError):
    status_code = 500
    message = "Storage failure"
