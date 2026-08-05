"""工具函数"""
import json


def extract_json(raw: str):
    """从模型回复里抠出 JSON。原版逻辑基础上，加上"抓第一个 { 到最后一个 }"兜底。"""
    if not raw:
        return None
    raw = raw.strip()

    # 处理 markdown 代码块
    if '```' in raw:
        parts = raw.split('```')
        for p in parts:
            p = p.strip()
            if p.startswith('json'):
                p = p[4:].strip()
            if p.startswith('{'):
                raw = p
                break

    # 直接尝试
    try:
        return json.loads(raw)
    except Exception:
        pass

    # 兜底：从第一个 { 到最后一个 }
    try:
        i = raw.find('{')
        j = raw.rfind('}')
        if i != -1 and j > i:
            return json.loads(raw[i:j + 1])
    except Exception:
        pass

    return None


def safe_str(v, default=''):
    if v is None:
        return default
    return str(v).strip()
