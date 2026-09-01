"""GojoAssistant Simple —— FastAPI 入口

相比完整版去掉了：群聊、睡前故事、语音通话流。
保留：聊天、图片、TTS、日记（含角色写/偷看/留言反应）、
      记忆（长期/羁绊/角色背景）、日程、记账、生理期、主动消息、头像。
"""
import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import config
from db import init_db
from characters import seed_all_characters

# ── 路由 ──
from route_accounting import router as accounting_router
from route_avatar import router as avatar_router
from route_character import router as character_router
from route_chat import router as chat_router
from route_config import router as config_router
from route_diary import router as diary_router
from route_image import router as image_router
from route_memory import router as memory_router
from route_period import router as period_router, init_period_table
from route_stats import router as stats_router
from route_tasks import router as tasks_router
from route_tts import router as tts_router
from route_proactive import router as proactive_router
from route_settings import router as settings_router
from db_diary import init_diary_tables
from db_promise import init_promise_table
from db_schedule import init_schedule_table
from migrate_two_level_recall import migrate_two_level
from proactive_msg import init_proactive_table
from push_notify import init_push_table
from route_courses import router as courses_router
from db_course import init_course_tables
from relationship_db import init_relationship_tables

app = FastAPI(title='GojoAssistant Simple')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.on_event('startup')
async def startup():
    init_db()
    init_diary_tables()
    init_promise_table()
    init_schedule_table()          # ★ 角色日程表（"已读不回"依赖）
    init_proactive_table()
    init_push_table()
    init_period_table()
    init_course_tables()
    init_relationship_tables()
    seed_all_characters()

    # ★ 两级召回列迁移（mention_count / linked_fact_id 等,幂等）
    try:
        migrate_two_level()
    except Exception as e:
        print(f'[startup] 两级召回迁移跳过：{e}')

    # RAG（可选，没配就自动退回关键词检索）
    try:
        import memory_search
        memory_search.init_vector_support()
    except Exception as e:
        print(f'[startup] RAG 初始化跳过：{e}')

    # 日记排程（角色定期写日记 / 偷看你日记 / 反应你的留言）
    try:
        from diary_scheduler import start_diary_scheduler
        start_diary_scheduler()
    except Exception as e:
        print(f'[startup] 日记排程启动失败：{e}')

    # 主动消息排程
    try:
        from proactive_scheduler import start_proactive_scheduler
        start_proactive_scheduler()
    except Exception as e:
        print(f'[startup] 主动消息排程启动失败：{e}')

    print('=' * 60)
    print('  GojoAssistant Simple 已启动')
    print(f'  Provider: {config.LLM_PROVIDER}')
    print(f'  主模型: {config.MODEL_MAIN}')
    print(f'  辅助模型: {config.MODEL_JP_AUX}')
    if not config.ANTHROPIC_KEY and config.LLM_PROVIDER == 'claude':
        print('  ⚠️  ANTHROPIC_KEY 未设置')
    if not config.DEEPSEEK_KEY and config.LLM_PROVIDER == 'deepseek':
        print('  ⚠️  DEEPSEEK_KEY 未设置')
    if not config.DATABASE_URL:
        print('  ⚠️  DATABASE_URL 未设置')
    print('=' * 60)


# ── 注册路由 ──
app.include_router(character_router)
app.include_router(avatar_router)
app.include_router(chat_router)
app.include_router(image_router)
app.include_router(tts_router)
app.include_router(diary_router)
app.include_router(memory_router)
app.include_router(tasks_router)
app.include_router(accounting_router)
app.include_router(period_router)
app.include_router(proactive_router)
app.include_router(stats_router)
app.include_router(config_router)
app.include_router(settings_router)
app.include_router(courses_router)

@app.get('/health')
async def health():
    return {'status': 'ok', 'provider': config.LLM_PROVIDER}


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    uvicorn.run(app, host='0.0.0.0', port=port)