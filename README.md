# Каталог файлов — REST API и веб-клиент

Лабораторная работа: веб-приложение с REST API и клиентской частью, полный набор
CRUD-операций над одной сущностью.



---

## Запуск

```bash
docker compose up --build
```



- интерфейс — http://localhost:5173
- Swagger UI — http://localhost:8000/docs

Больше ничего настраивать не нужно: база поднимается вместе с приложением,
миграции применяются автоматически при старте контейнера.

### Почему два порта
> Логин и пароль базы (`fileapp` / `fileapp`) намеренно записаны прямо в
> `docker-compose.yml`, а не в `.env`: файл `.env` перечислен в `.gitignore`
> и не попал бы в репозиторий, а проект должен запускаться сразу после
> клонирования. Порт PostgreSQL наружу не публикуется.

### Запуск без Docker

Нужны Python 3.12 и работающий PostgreSQL.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

createdb filesharing
export DATABASE_URL="postgresql+asyncpg://<пользователь>@localhost:5432/filesharing"
export STORAGE_DIR="./storage"
export CORS_ORIGINS="http://localhost:5173"

alembic upgrade head
uvicorn app.main:app --port 8000          # API
```

Во втором терминале — клиент:

```bash
export API_BASE_URL="http://localhost:8000"
uvicorn app.frontend:app --port 5173
```

---

## Модель данных

Одна сущность — запись о файле, таблица `files`.

| Поле | Тип | Обязательное | Описание |
|---|---|---|---|
| `id` | UUID | да | Идентификатор, генерирует сервер |
| `filename` | string | да | Имя файла, 1–255 символов |
| `description` | string | нет | Описание, до 5000 символов, по умолчанию пустое |
| `size_bytes` | integer | нет | Размер содержимого, проставляет сервер |
| `is_public` | boolean | нет | Признак публичности, по умолчанию `false` |
| `content_type` | string | нет | MIME-тип, проставляет сервер при загрузке |
| `created_at` | datetime | да | Момент создания, проставляет сервер |
| `updated_at` | datetime | да | Момент последнего изменения |

Идентификаторы — UUIDv4

Схема создаётся миграцией Alembic (`alembic/versions/0001_initial_schema.py`)

---

## Эндпоинты

### Основные — CRUD над сущностью

| Метод | Путь | Назначение | Успех |
|---|---|---|---|
| GET | `/api/files` | Список записей | 200 |
| GET | `/api/files/{id}` | Одна запись | 200 |
| POST | `/api/files` | Создать запись | 201 + `Location` |
| PUT | `/api/files/{id}` | Заменить запись целиком | 200 |
| PATCH | `/api/files/{id}` | Изменить отдельные поля | 200 |
| DELETE | `/api/files/{id}` | Удалить запись | 204 |






### Расширение сверх ТЗ — содержимое файлов

| Метод | Путь | Назначение |
|---|---|---|
| PUT | `/api/files/{id}/content` | Загрузить содержимое (multipart) |
| GET | `/api/files/{id}/content` | Скачать содержимое |

Загрузка — PUT, а не POST, потому что повторный вызов заменяет содержимое, а не
создаёт вторую копию. Запись и её содержимое создаются в два шага: сначала
`POST /api/files` отдаёт идентификатор, затем по этому адресу догружаются байты.
Шесть основных эндпоинтов работают полностью без этих двух и обмениваются
только JSON.

Имя файла на диске — это UUID записи; пользовательское `filename` в построении
пути не участвует.

---

## Коды ответов и формат ошибок

| Код | Когда |
|---|---|
| 200 | Успешные GET, PUT, PATCH |
| 201 | Создание записи |
| 204 | Удаление, тело пустое |
| 400 | Ошибка валидации или некорректный JSON в теле |
| 404 | Запись не найдена |
| 500 | Внутренняя ошибка |

Все ошибки возвращается в одном формате:

```json
{
  "error": "Validation failed",
  "details": ["filename: String should have at most 255 characters"]
}
```

Валидация выполняется на сервере через Pydantic-схемы

---

## Примеры запросов

```bash
# создать
curl -i -X POST localhost:8000/api/files \
  -H 'Content-Type: application/json' \
  -d '{"filename":"отчёт.pdf","description":"за март","is_public":true}'

# список и одна запись
curl localhost:8000/api/files
curl localhost:8000/api/files/<id>

# заменить целиком
curl -X PUT localhost:8000/api/files/<id> \
  -H 'Content-Type: application/json' \
  -d '{"filename":"итог.pdf","description":"","is_public":false}'

# изменить одно поле
curl -X PATCH localhost:8000/api/files/<id> \
  -H 'Content-Type: application/json' -d '{"is_public":true}'

# загрузить и скачать содержимое
curl -X PUT localhost:8000/api/files/<id>/content -F "file=@./отчёт.pdf"
curl -OJ localhost:8000/api/files/<id>/content

# удалить
curl -i -X DELETE localhost:8000/api/files/<id>

# некорректный JSON — вернётся 400, сервер продолжит работать
curl -i -X POST localhost:8000/api/files \
  -H 'Content-Type: application/json' -d '{"filename":'
```

---

## Клиентская часть

Две страницы на порту 5173, все операции через `fetch` — страница не
перезагружается.

**Список — `/`**

- таблица: имя с кратким описанием, размер, доступ, дата создания;
- зона перетаскивания — брошенные файлы сразу становятся записями;
- форма добавления с полями сущности и выбором файла;
- переключатель публичности в строке — отправляет **PATCH**;
- удаление с подтверждением, поиск, фильтр по публичности;
- клик по строке открывает страницу записи.

**Страница записи — `/files/{id}`**

- все поля записи, включая служебные сведения;
- форма редактирования с предзаполнением — отправляет **PUT**;
- загрузка и скачивание содержимого, копирование ссылки;
- удаление с подтверждением и возвратом к списку.

Общее для обеих страниц: индикация загрузки, сообщение при пустом списке,
ошибки сервера выводятся текстом из поля `details`, список обновляется после
каждой операции сам.

---

## Структура проекта

```
app/
  main.py              приложение API: CORS, роутеры, обработчики ошибок
  frontend.py          приложение клиента: страницы, статика, /config.js
  core/
    config.py          настройки из переменных окружения
    exceptions.py      доменные исключения
  db/
    base.py            декларативная база с правилами именования
    models.py          ORM-модель FileRecord
    session.py         движок, фабрика сессий, границы транзакции
  schemas/             Pydantic-схемы запросов и ответов
  repositories/
    interfaces/        Protocol-интерфейс хранилища
    sqlalchemy/        реализация на SQLAlchemy
  services/
    file_service.py    бизнес-логика, про HTTP не знает
    storage.py         работа с файлами на диске
  api/
    deps.py            сборка зависимостей
    errors.py          перевод исключений в HTTP-ответы
    routers/           files, content, front (отдаёт две HTML-страницы)
alembic/               миграции
static/
  html/index.html      список записей
  html/detail.html     страница одной записи
  js/common.js         общие утилиты обеих страниц
  js/app.js, detail.js логика страниц
docker/entrypoint.sh   ожидание БД, миграции, запуск сервера
```

Слои разделены: роутер принимает запрос, сервис содержит логику и бросает
доменные исключения, репозиторий работает с БД. Сервис не импортирует FastAPI,
поэтому HTTP-коды не могут случайно подменить друг друга.
