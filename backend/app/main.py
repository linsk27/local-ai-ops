from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.core.auth import user_from_request
from app.core.config import get_settings
from app.database import SessionLocal, init_db
from app.services.seed import purge_legacy_sample_data


settings = get_settings()

app = FastAPI(title=settings.app_name, version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix="/api")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if settings.auth_enabled and request.url.path.startswith("/api"):
        public_paths = {"/api/auth/login"}
        if request.method != "OPTIONS" and request.url.path not in public_paths:
            try:
                user_from_request(request)
            except Exception as exc:
                status_code = getattr(exc, "status_code", 401)
                detail = getattr(exc, "detail", "Authentication required")
                return JSONResponse(status_code=status_code, content={"detail": detail})
    return await call_next(request)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    with SessionLocal() as db:
        purge_legacy_sample_data(db)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
