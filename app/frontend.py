"""Отдельное приложение для клиентской части.

Запускается своим процессом на своём порту, поэтому страница и API оказываются
на разных источниках — ровно та схема, под которую в API включён CORS.
Переиспользует тот же роутер страниц, что и раньше.
"""

from fastapi import FastAPI, Response
from fastapi.staticfiles import StaticFiles

from app.api.routers import front
from app.core.config import STATIC_DIR, get_settings


def create_frontend_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="File Sharing CRUD — клиент",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.get("/config.js", include_in_schema=False)
    async def config_js() -> Response:
        """Отдаёт клиенту адрес API. Жёстко в разметку он не зашит."""
        return Response(
            content=f'window.API_BASE = "{settings.api_base_url}";\n',
            media_type="application/javascript",
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/health", include_in_schema=False)
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(front.router)
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app


app = create_frontend_app()
