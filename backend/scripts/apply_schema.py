"""Apply idempotent PostgreSQL schema migrations from init_schemas.sql."""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from src.db.connection import init_database


if __name__ == "__main__":
    init_database()
    print("Schema initialization completed.")
