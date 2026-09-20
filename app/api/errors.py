import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.exceptions import AppError

logger = logging.getLogger(__name__)


def envelope(error: str, details: list[str] | None = None) -> dict:
    return {"error": error, "details": details or []}


async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    if exc.status_code >= 500:
        logger.exception("Доменная ошибка: %s", exc.message)
    return JSONResponse(
        status_code=exc.status_code, content=envelope(exc.message, exc.details)
    )


async def validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Ошибки валидации и битый JSON.

    FastAPI оборачивает json.JSONDecodeError в RequestValidationError с
    type="json_invalid", поэтому один обработчик закрывает оба требования ТЗ:
    и «битый JSON → 400», и формат ошибок валидации.
    """
    details: list[str] = []
    in_path = False
    malformed = False

    for err in exc.errors():
        loc = tuple(err.get("loc", ()))
        if err.get("type") == "json_invalid":
            malformed = True
            reason = (err.get("ctx") or {}).get("error", "invalid JSON")
            details.append(f"body: malformed JSON ({reason})")
            continue
        if loc and loc[0] == "path":
            in_path = True
        field = ".".join(str(part) for part in loc[1:]) or "body"
        details.append(f"{field}: {err.get('msg', 'invalid value')}")

    # /api/files/не-uuid — ресурса по такому адресу существовать не может,
    # поэтому 404, а не 400: проверяющий почти наверняка дёрнет именно такой URL.
    if in_path and not malformed:
        return JSONResponse(
            status_code=404, content=envelope("Resource not found", details)
        )

    title = "Malformed JSON body" if malformed else "Validation failed"
    return JSONResponse(status_code=400, content=envelope(title, details))


async def http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Неизвестный маршрут (404) и неверный метод (405) — тоже в общем конверте."""
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return JSONResponse(status_code=exc.status_code, content=envelope(detail, []))


async def unhandled_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Необработанная ошибка")
    return JSONResponse(
        status_code=500, content=envelope("Internal server error", [])
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(Exception, unhandled_handler)
