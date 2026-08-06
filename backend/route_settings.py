"""后端设置路由：GET /settings / PUT /settings

用户在 App 设置页填 API key、切 provider 等，存进 DB settings 表。
改完立刻生效，不用重启服务、不用改 Zeabur 环境变量。
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from . import config as cfg

router = APIRouter()


@router.get('/settings')
async def get_all_settings():
    """返回所有可改字段的当前值（密钥打码显示）"""
    return JSONResponse(cfg.dump_all_settings())


@router.put('/settings')
async def update_settings(data: dict):
    """
    接收一个 dict，里面是要改的字段。只有在 _DEFAULTS 白名单里的字段才允许写入。
    示例：{ "ANTHROPIC_API_KEY": "sk-ant-xxx", "LLM_PROVIDER": "claude" }
    """
    updated = []
    errors = []
    for key, value in data.items():
        try:
            cfg.set_setting(key, str(value) if value is not None else '')
            updated.append(key)
        except ValueError as e:
            errors.append(str(e))

    if errors and not updated:
        return JSONResponse({'error': '; '.join(errors)}, status_code=400)

    return JSONResponse({
        'ok': True,
        'updated': updated,
        'errors': errors if errors else None,
    })
