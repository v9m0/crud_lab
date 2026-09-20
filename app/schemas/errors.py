from pydantic import BaseModel, ConfigDict


class ErrorResponse(BaseModel):
    """Единый формат ошибки, который требует ТЗ."""

    error: str
    details: list[str] = []

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "error": "Validation failed",
                "details": ["filename: Field required"],
            }
        }
    )


ERROR_RESPONSES: dict[int | str, dict] = {
    400: {"model": ErrorResponse, "description": "Некорректные данные запроса"},
    404: {"model": ErrorResponse, "description": "Ресурс не найден"},
    500: {"model": ErrorResponse, "description": "Внутренняя ошибка сервера"},
}
