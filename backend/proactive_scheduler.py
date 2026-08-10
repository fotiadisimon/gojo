"""主动消息常驻排程 —— 【承诺驱动 + 日程驱动】版

两条触发线，互不干扰：

一、承诺驱动（原有）
   读 proactive_promise 表，只有【真的存在约定】的用户才收到。
   陌生用户没有承诺 → 静默跳过，不打扰。

二、★ 日程驱动（新增）
   扫 tasks 表，纪念日和临近的日程会让角色主动开口：
     · 纪念日前一天晚上   → 「明天是……」
     · 纪念日当天早上     → 「今天是……」
     · 当天有具体时间的事 → 提前 30~90 分钟
     · 当天没时间的事     → 早上提一次
   每条日程每天最多提一次（靠 proactive_msg.kind 去重）。
   角色仍然可以选择"什么都不说"——关系浅的时候不该越界。

★ v2 改动：LLM 调用改走 llm.call_llm，claude / deepseek / gemini 都能用
  （原来在模块级写死 anthropic.Anthropic，换 provider 后整个排程是坏的）
"""
import threading
import time
from datetime import datetime, timedelta, date

from config import CN_TZ, DEFAULT_CHARACTER_ID
from characters import get_character
from user_memory import get_bond_memories, save_short_memory, get_short_memory
from character_relations import get_relations_text
from llm import call_llm, LLMError
from utils import extract_json
import proactive_msg
import db_promise

_thread = None
_stop = False


def _now():
    return datetime.now(CN_TZ)


# ══════════════════════════════════════════════
#  共用：让角色生成一条主动消息并推送
# ══════════════════════════════════════════════

def _speak(character_id, user_id, kind, scene_prompt, now):
    """把 scene_prompt 交给 LLM，生成一条角色的主动消息 → 存库 + 推送。

    返回 msg_id 或 None（角色决定不说话 / 生成失败时返回 None）。
    """
    char = get_character(character_id)
    if not char:
        print(f'[proactive] 角色 {character_id} 不存在，跳过')
        return None
    char_name = char['name']
    voice_id = char.get('voice_id')
    core_prompt = char.get('core_prompt', '')
    canon_lock = char.get('canon_lock', '') or ''

    time_str = now.strftime('%Y年%m月%d日 %H:%M')

    # 最近对话（判断当前关系状态用）
    try:
        shorts = get_short_memory(user_id, 4, character_id)
        recent = '\n'.join(f'{"她" if r=="user" else "我"}：{c}' for r, c in shorts) if shorts else '(最近没聊)'
    except Exception:
        recent = '(拉最近对话失败)'

    # 共同经历
    try:
        bonds = get_bond_memories(user_id, character_id, kind='between', limit=6)
        bond_text = '\n'.join(f'- {b[1]}' for b in bonds) if bonds else '(还没什么共同的事)'
    except Exception:
        bond_text = '(拉共同经历失败)'

    relations_block = get_relations_text(character_id)
    relations_intro = (f'\n{relations_block}\n' if relations_block else '')

    system_prompt = f'''{core_prompt}
{canon_lock}

你现在不是在回复她，是【你自己想不想开口】。'''

    user_prompt = f'''现在是 {time_str}。
{scene_prompt}
{relations_intro}
【你们最近聊过什么】
{recent}

【你们之间累计的事】
{bond_text}

【★ 你要判断】
根据当前你对她的真实态度（读上面的记忆），你要不要说、说什么、怎么说：
- 关系深、有感情积累 → 你可能会自然带上关心
- 关系还浅、公事化 → 简短提一下就好，不越界
- 你对她反感 / 完全陌生 → 你可以选择【什么都不说】，输出 {{"skip": true, "reason": "..."}}

【铁律】
- 措辞由【当前记忆里的关系】决定，不由这件事本身的分量决定
- 不要为了"温暖"而暖，不要为了"冷淡"而冷 —— 按此刻真实的你
- 【严禁】"付き合ってやった"这种傲娇陪伴腔，更不要"陪你一会儿"这类
- 不熟就短，别脑补场景细节
- 不要像日历播报，用「明天」「今天」这种人话

【输出格式（严格 JSON，一行）】
决定说 → {{"jp":"日语","zh":"中文","emotion":"情绪"}}
决定跳过 → {{"skip": true, "reason": "简要原因"}}
emotion 选: 平静/自信/调皮/认真/温柔/冷淡'''

    try:
        raw = call_llm(
            system_prompt,
            [{'role': 'user', 'content': user_prompt}],
            max_tokens=400, temperature=0.8, prefer_fast=True,
        ).strip()
    except LLMError as e:
        print(f'[proactive] LLM 调用失败：{e}')
        return None
    except Exception as e:
        print(f'[proactive] LLM 异常：{e}')
        return None

    parsed = extract_json(raw)
    if not parsed:
        print(f'[proactive] 解析失败: {raw[:80]}')
        return None

    if parsed.get('skip'):
        print(f'[proactive] {character_id} 决定跳过: {parsed.get("reason", "")}')
        return 'skipped'      # ★ 返回特殊值，让调用方知道"处理过了"，别反复触发

    jp = (parsed.get('jp') or '').strip()
    zh = (parsed.get('zh') or '').strip()
    emotion = parsed.get('emotion', '平静')
    if not jp:
        print('[proactive] jp 为空，跳过')
        return None

    # 合成语音（失败不影响文字消息）
    audio_b64 = ''
    try:
        from tts import tts_to_b64
        audio_b64 = tts_to_b64(jp, emotion, voice_id) or ''
    except Exception as e:
        print(f'[proactive] TTS 出错: {e}')

    mid, ts = proactive_msg.add_proactive_msg(
        character_id, user_id, kind, jp, zh, emotion, audio_b64, created_at=now
    )
    print(f'[proactive] ✅ [{kind}] msg #{mid}: {jp[:40]}')

    try:
        save_short_memory(user_id, 'assistant', jp, character_id)
    except Exception as e:
        print(f'[proactive] 写 short_memory 跳过: {e}')

    try:
        import push_notify
        push_notify.push_to_user(
            user_id,
            title=char_name,
            body=zh or jp,
            data={'type': 'proactive', 'character_id': character_id, 'kind': kind},
        )
    except Exception as e:
        print(f'[proactive] 推送跳过: {e}')

    return mid


# ══════════════════════════════════════════════
#  一、承诺驱动（原有逻辑）
# ══════════════════════════════════════════════

def generate_from_promise(promise, now):
    """根据一条 promise，让角色生成他要说的话。"""
    try:
        context = promise['context']
        origin_text = promise.get('origin_text', '')
        scene = f'''【★ 触发场景】
之前的对话里，你答应过 / 记下了这件事：
「{context}」
{f"(她当时的原话大致是: 「{origin_text}」)" if origin_text else ""}

现在到了这个时刻，你【可能】要主动开口说点什么。'''

        r = _speak(promise['character_id'], promise['user_id'], 'promise', scene, now)
        # 不管说了还是跳过，都标记已触发，避免这个 tick 反复处理
        if r is not None:
            db_promise.mark_fired(promise['id'], now)
        return r
    except Exception as e:
        print(f'[promise] 生成出错: {e}')
        return None


# ══════════════════════════════════════════════
#  二、★ 日程 / 纪念日驱动（新增）
# ══════════════════════════════════════════════

def _pick_character_for(user_id):
    """这条提醒该由谁来说 —— 优先最近聊过的角色，否则默认角色。"""
    try:
        from db import get_conn
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            '''SELECT character_id FROM chat_history
               WHERE user_id = %s AND character_id IS NOT NULL
               ORDER BY id DESC LIMIT 1''',
            (user_id,)
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row and row[0]:
            return row[0]
    except Exception:
        pass
    return DEFAULT_CHARACTER_ID


def _already_spoke_today(user_id, kind, now):
    """今天是不是已经为这条日程说过话了（同一个 kind 一天只发一次）。"""
    try:
        from db import get_conn
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            'SELECT COUNT(*) FROM proactive_msg WHERE user_id=%s AND kind=%s AND created_at >= %s',
            (user_id, kind, today_start)
        )
        n = cur.fetchone()[0]
        cur.close()
        conn.close()
        return n > 0
    except Exception as e:
        print(f'[schedule] 查重出错（当作已发，避免刷屏）: {e}')
        return True


def _collect_schedule_triggers(now):
    """扫 tasks 表，返回这一刻该触发的提醒。

    返回 [(user_id, kind_tag, scene_prompt), ...]
    """
    try:
        from db import get_conn
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            '''SELECT id, user_id, title, category, due_date, due_time, completed, repeat_type
               FROM tasks WHERE due_date IS NOT NULL'''
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
    except Exception as e:
        print(f'[schedule] 读 tasks 出错: {e}')
        return []

    today = now.date()
    hour = now.hour
    out = []

    # 时间窗：早上 8~10 点报当天的事；晚上 20~22 点报明天的纪念日
    morning_window = 8 <= hour < 10
    evening_window = 20 <= hour < 22

    for tid, user_id, title, category, due_date, due_time, completed, repeat_type in rows:
        if not due_date:
            continue
        if isinstance(due_date, str):
            try:
                d = datetime.strptime(due_date[:10], '%Y-%m-%d').date()
            except ValueError:
                continue
        else:
            d = due_date

        is_anniv = (category == '纪念日')
        yearly = (repeat_type == 'yearly')

        # ── 纪念日 ──
        if is_anniv:
            if yearly:
                target = date(today.year, d.month, d.day)
                if target < today:
                    target = date(today.year + 1, d.month, d.day)
            else:
                target = d
            delta = (target - today).days

            if delta == 0 and morning_window:
                out.append((user_id, f'sched:{tid}:day',
                    f'''【★ 触发场景】
今天是「{title}」—— 她日历上标着的纪念日{"（每年的）" if yearly else ""}。
你恰好记得这件事。要不要说点什么，你自己决定。'''))
            elif delta == 1 and evening_window:
                out.append((user_id, f'sched:{tid}:eve',
                    f'''【★ 触发场景】
明天是「{title}」—— 她日历上标着的纪念日{"（每年的）" if yearly else ""}。
现在是前一天晚上，你想起了这件事。'''))
            continue

        # ── 普通日程（已完成的不提）──
        if completed:
            continue
        delta = (d - today).days
        if delta != 0:
            continue

        if due_time:
            # 有具体时间：提前 30~90 分钟提一次
            try:
                hh, mm = str(due_time)[:5].split(':')
                due_dt = now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
            except Exception:
                continue
            mins_left = (due_dt - now).total_seconds() / 60
            if 30 <= mins_left <= 90:
                out.append((user_id, f'sched:{tid}:pre',
                    f'''【★ 触发场景】
她今天 {str(due_time)[:5]} 有「{title}」，现在离那会儿还有一个小时左右。
你恰好记得这件事。'''))
        else:
            # 没时间：早上提一次
            if morning_window:
                out.append((user_id, f'sched:{tid}:day',
                    f'''【★ 触发场景】
她今天要做的事里有「{title}」，没写具体几点。
你恰好记得这件事。'''))

    return out


def _tick_schedule(now):
    """日程 / 纪念日驱动的一次扫描。"""
    triggers = _collect_schedule_triggers(now)
    if not triggers:
        return
    for user_id, kind_tag, scene in triggers:
        try:
            if _already_spoke_today(user_id, kind_tag, now):
                continue
            character_id = _pick_character_for(user_id)
            _speak(character_id, user_id, kind_tag, scene, now)
        except Exception as e:
            print(f'[schedule] 处理 {kind_tag} 出错: {e}')


# ══════════════════════════════════════════════
#  主循环
# ══════════════════════════════════════════════

def _tick():
    now = _now()

    # 一、承诺
    try:
        due = db_promise.get_due_promises(now)
        if due:
            print(f'[promise] tick: 有 {len(due)} 条到期')
            for p in due:
                try:
                    generate_from_promise(p, now)
                except Exception as e:
                    print(f'[promise] 处理 #{p["id"]} 出错: {e}')
    except Exception as e:
        print(f'[promise] 查 due 出错: {e}')

    # 二、日程 / 纪念日
    try:
        _tick_schedule(now)
    except Exception as e:
        print(f'[schedule] tick 出错: {e}')


def _loop():
    global _stop
    time.sleep(90)  # 启动后稍等，别抢初始化
    while not _stop:
        try:
            _tick()
        except Exception as e:
            print(f'[proactive] tick 出错: {e}')
        time.sleep(600)  # 每 10 分钟检查一次


def start_proactive_scheduler():
    global _thread
    if _thread is not None:
        return
    _thread = threading.Thread(target=_loop, daemon=True)
    _thread.start()
    print('[proactive] 主动排程已启动（承诺 + 日程/纪念日）')