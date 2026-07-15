"""
模拟实时数据生成器
当东方财富 API 不可用时，基于静态配置生成模拟行情
添加±2%的随机波动，模拟真实行情的变化
"""

import random
import time
import hashlib

# 基础价格 (来自前端 gridProducts.ts 的静态配置)
BASE_PRICES: dict[str, dict] = {
    "510050": {"price": 2.85, "name": "上证50ETF"},
    "510300": {"price": 4.05, "name": "沪深300ETF(沪)"},
    "159919": {"price": 4.08, "name": "沪深300ETF(深)"},
    "510500": {"price": 5.95, "name": "中证500ETF"},
    "588000": {"price": 1.12, "name": "科创50ETF"},
    "513130": {"price": 0.580, "name": "恒生科技ETF"},
    "513220": {"price": 0.420, "name": "恒生互联网ETF"},
    "513050": {"price": 1.150, "name": "中概互联ETF"},
    "159920": {"price": 1.250, "name": "恒生ETF"},
    "510900": {"price": 0.880, "name": "H股ETF"},
    "513120": {"price": 0.960, "name": "港股通50ETF"},
    "513190": {"price": 1.080, "name": "港股通金融ETF"},
    "513600": {"price": 0.540, "name": "恒生科技指数ETF"},
    "513100": {"price": 1.850, "name": "纳指ETF"},
    "513500": {"price": 2.100, "name": "标普500ETF"},
    "159941": {"price": 1.820, "name": "纳指ETF深"},
    "159659": {"price": 1.560, "name": "纳斯达克100ETF"},
    "159632": {"price": 1.580, "name": "纳斯达克ETF沪"},
    "159866": {"price": 1.420, "name": "日经ETF"},
    "513030": {"price": 1.380, "name": "德国ETF"},
    "518880": {"price": 5.85, "name": "黄金ETF"},
    "159937": {"price": 5.82, "name": "黄金ETF深"},
    "159985": {"price": 1.95, "name": "豆粕ETF"},
    "161226": {"price": 0.92, "name": "白银LOF"},
    "159980": {"price": 1.65, "name": "有色金属ETF"},
}


def _seed_from_code(code: str) -> float:
    """从代码生成确定性的随机种子 (每30秒变化一次)"""
    bucket = int(time.time() / 30)
    seed_str = f"{code}_{bucket}"
    h = hashlib.md5(seed_str.encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def get_simulated_snapshot(code: str) -> dict:
    """生成模拟实时快照"""
    base = BASE_PRICES.get(code)
    if not base:
        return {"error": f"Unknown code: {code}"}

    rng = _seed_from_code(code)
    # ±2% 随机波动
    change_pct = (rng - 0.5) * 4  # -2% ~ +2%
    price = base["price"] * (1 + change_pct / 100)

    return {
        "price": round(price, 3),
        "high": round(price * (1 + abs(change_pct) / 200), 3),
        "low": round(price * (1 - abs(change_pct) / 200), 3),
        "open": round(base["price"], 3),
        "volume": int(rng * 100000000),
        "turnover": price * int(rng * 100000000),
        "name": base["name"],
        "prev_close": round(base["price"], 3),
        "change_pct": round(change_pct, 2),
        "pe": None,
        "simulated": True,
    }
