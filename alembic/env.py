import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.base import Base
from app.db import models  # noqa: F401  — регистрирует таблицы в Base.metadata

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    """URL берём прямо из окружения.

    Через config.set_main_option его проводить нельзя: Alembic хранит конфиг в
    ConfigParser с интерполяцией, и пароль с символом '%' уронит миграции
    с InterpolationSyntaxError.
    """
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("Переменная окружения DATABASE_URL не задана")
    return url


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    engine = create_async_engine(get_url(), poolclass=pool.NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(run_async_migrations())
