#!/bin/sh
set -e

# Образ один на оба сервиса. База нужна только API, поэтому ожидание и
# миграции выполняются лишь там, где задан DATABASE_URL.
if [ -n "$DATABASE_URL" ]; then
    echo "Ожидание базы данных..."
    python - <<'PY'
import asyncio
import os
import sys

import asyncpg


async def wait_for_db() -> None:
    dsn = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    last_error = None
    for attempt in range(1, 61):
        try:
            conn = await asyncpg.connect(dsn)
            await conn.close()
            print(f"База данных готова (попытка {attempt})")
            return
        except Exception as exc:
            last_error = exc
            await asyncio.sleep(1)
    sys.exit(f"База данных недоступна за 60 секунд: {last_error}")


asyncio.run(wait_for_db())
PY

    echo "Применение миграций..."
    alembic upgrade head
else
    echo "DATABASE_URL не задан — пропускаю ожидание базы и миграции"
fi

echo "Запуск..."
exec "$@"
