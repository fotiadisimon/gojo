"""pytest 通用夹具

关键：用一个临时 SQLite 文件替代真实 data.db，测试完全隔离。
"""
import os
import sys
import tempfile
from pathlib import Path

import pytest

# 让 `from backend...` 找得到
_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


@pytest.fixture(scope='session', autouse=True)
def _temp_db():
    """整个测试会话共用一个临时库。"""
    fd, path = tempfile.mkstemp(suffix='.db')
    os.close(fd)
    os.environ['DB_PATH'] = path

    # 因为 config 在 import 时就把 DB_PATH 读到常量里了，得直接改
    from backend import config as cfg
    cfg.DB_PATH = path

    yield path

    try:
        os.unlink(path)
    except OSError:
        pass


@pytest.fixture
def client():
    """TestClient — 每次都重新 create_app 保证干净。"""
    from fastapi.testclient import TestClient
    from backend.gojo_server import create_app
    return TestClient(create_app())


@pytest.fixture(autouse=True)
def _clean_tables():
    """每个测试用例前后清表，用例之间互不影响。"""
    from backend.db import get_conn
    yield
    with get_conn() as conn:
        for t in ('chat_history', 'tasks', 'accounting', 'diary', 'characters'):
            conn.execute(f'DELETE FROM {t}')
