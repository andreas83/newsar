"""
Shared database connector for ML scripts.
Uses DATABASE_URL env var, returns pandas DataFrames via SQLAlchemy.
"""

import os
import pandas as pd
from sqlalchemy import create_engine, text

_engine = None

def get_engine():
    global _engine
    if _engine is None:
        url = os.environ.get('DATABASE_URL')
        if not url:
            raise RuntimeError('DATABASE_URL environment variable not set')
        _engine = create_engine(url, pool_pre_ping=True)
    return _engine

def query(sql: str, params: dict | None = None) -> pd.DataFrame:
    """Execute SQL and return results as a DataFrame."""
    engine = get_engine()
    with engine.connect() as conn:
        return pd.read_sql(text(sql), conn, params=params)

def execute(sql: str, params: dict | None = None):
    """Execute a non-SELECT statement."""
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text(sql), params or {})
