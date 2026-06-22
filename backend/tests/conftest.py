import os
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite:///./test.db")
os.environ.setdefault("ALIYUN_MODE", "real")
os.environ.setdefault("MASTER_KEY", "test-master-key")

test_db = Path("test.db")
if test_db.exists():
    test_db.unlink()
