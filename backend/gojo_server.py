"""GojoAssistant Simple - FastAPI 入口

对齐原版 gojo_server.py 的位置和写法。
所有业务逻辑在同目录其他文件里（route_chat / route_diary / route_tasks / route_accounting）。
"""
import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config as cfg
from .characters import seed_default_if_empty
from .db import init_db
from .route_accounting import router as accounting_router
from .route_character import router as character_router
from .route_chat import router as chat_router
from .route_diary import router as diary_router
from .route_image import router as image_router
from .route_settings import router as settings_router
from .route_tasks import router as tasks_router
from .route_tts import router as tts_router


def create_app() -> FastAPI:
    """工厂函数，方便测试注入。"""
    app = FastAPI(title='GojoAssistant Simple')

    app.add_middleware(
        CORSMiddleware,
        allow_origins=['*'],
        allow_methods=['*'],
        allow_headers=['*'],
    )

    init_db()
    seed_default_if_empty()

    app.include_router(character_router)
    app.include_router(chat_router)
    app.include_router(image_router)
    app.include_router(settings_router)
    app.include_router(tts_router)
    app.include_router(diary_router)
    app.include_router(tasks_router)
    app.include_router(accounting_router)

    @app.get('/health')
    async def health():
        return {'status': 'ok', 'provider': cfg.get('LLM_PROVIDER')}

    @app.get('/config')
    async def public_config():
        """给前端拉的公开配置（不含密钥）"""
        return cfg.dump_public_config()

    return app


app = create_app()


def main():
    provider = cfg.get('LLM_PROVIDER')
    has_key = cfg.get('ANTHROPIC_API_KEY') if provider == 'claude' else cfg.get('DEEPSEEK_API_KEY')
    model = cfg.get('CLAUDE_MODEL') if provider == 'claude' else cfg.get('DEEPSEEK_MODEL')

    print('=' * 60)
    print(f'  GojoAssistant Simple 启动中')
    print(f'  Provider: {provider}   Model: {model}')
    print(f'  Character: {cfg.get('CHARACTER_NAME')}')
    if not has_key:
        print(f'  ⚠️  {provider.upper()}_API_KEY 未设置——聊天功能会返回错误')
        print(f'      请在 .env 或 config.json 里填 API key')
    print(f'  DB: {cfg.DB_PATH}')
    print(f'  Port: {cfg.PORT}')
    print('=' * 60)

    uvicorn.run(app, host='0.0.0.0', port=cfg.PORT)


if __name__ == '__main__':
    main()
