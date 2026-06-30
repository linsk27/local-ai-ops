from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


def _engine_kwargs(database_url: str) -> dict:
    if database_url.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False}}
    return {"pool_pre_ping": True}


settings = get_settings()
engine = create_engine(settings.database_url, **_engine_kwargs(settings.database_url))
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def init_db() -> None:
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _run_lightweight_migrations(engine)


def _run_lightweight_migrations(db_engine: Engine) -> None:
    inspector = inspect(db_engine)
    table_names = set(inspector.get_table_names())
    if "checks" not in table_names:
        return

    check_columns = {column["name"] for column in inspector.get_columns("checks")}
    statements: list[str] = []
    if "group_id" not in check_columns:
        if db_engine.dialect.name == "postgresql":
            statements.append("ALTER TABLE checks ADD COLUMN IF NOT EXISTS group_id INTEGER")
        else:
            statements.append("ALTER TABLE checks ADD COLUMN group_id INTEGER")

    if not statements:
        return

    with db_engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
