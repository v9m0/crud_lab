from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.errors import register_exception_handlers
from app.api.routers import files, front
from app.core.config import STATIC_DIR, get_settings

TAGS_METADATA = [
    {
        "name": "files",
        "description": "Основная сущность. Шесть эндпоинтов CRUD на едином пути /api/files.",
    },
    {
        "name": "files-content",
        "description": "Расширение сверх ТЗ: загрузка и выдача содержимого файла.",
    },
]


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="File Sharing CRUD",
        description="Лабораторная работа: REST API и клиентская часть с полным набором CRUD-операций.",
        version="1.0.0",
        openapi_tags=TAGS_METADATA,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)

    app.include_router(files.router)
    app.include_router(front.router)
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/health", include_in_schema=False)
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
