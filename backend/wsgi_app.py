"""
纯 WSGI 应用 - 专为 PythonAnywhere 兼容
提供与 FastAPI 版本相同的 API
"""

import json
import sys
import os
import time
from urllib.parse import parse_qs

# 添加 backend 目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.chdir(os.path.dirname(os.path.abspath(__file__)))

from simulated_data import get_simulated_snapshot, BASE_PRICES

# 尝试导入真实行情客户端
try:
    from eastmoney_client import get_etf_snapshot
    _has_real_data = True
except Exception:
    _has_real_data = False

# ETF 品种配置
ETF_PRODUCTS = [
    {"id": "a-hstech", "code": "513130", "market": "1", "name": "恒生科技ETF"},
    {"id": "a-hsient", "code": "513220", "market": "1", "name": "恒生互联网ETF"},
    {"id": "a-hsient2", "code": "513050", "market": "1", "name": "中概互联ETF"},
    {"id": "a-hsi", "code": "159920", "market": "0", "name": "恒生ETF"},
    {"id": "a-hsi2", "code": "510900", "market": "1", "name": "H股ETF"},
    {"id": "a-hkstock50", "code": "513120", "market": "1", "name": "港股通50ETF"},
    {"id": "a-hkfinance", "code": "513190", "market": "1", "name": "港股通金融ETF"},
    {"id": "a-hstech2", "code": "513600", "market": "1", "name": "恒生科技指数ETF"},
    {"id": "a-nasdaq", "code": "513100", "market": "1", "name": "纳指ETF"},
    {"id": "a-sp500", "code": "513500", "market": "1", "name": "标普500ETF"},
    {"id": "a-nasdaq2", "code": "159941", "market": "0", "name": "纳指ETF深"},
    {"id": "a-nasdaq100", "code": "159659", "market": "0", "name": "纳斯达克100ETF"},
    {"id": "a-nasdaq3", "code": "159632", "market": "0", "name": "纳斯达克ETF沪"},
    {"id": "a-nikkei", "code": "159866", "market": "0", "name": "日经ETF"},
    {"id": "a-germany", "code": "513030", "market": "1", "name": "德国ETF"},
    {"id": "a-gold", "code": "518880", "market": "1", "name": "黄金ETF"},
    {"id": "a-gold2", "code": "159937", "market": "0", "name": "黄金ETF深"},
    {"id": "a-doupo", "code": "159985", "market": "0", "name": "豆粕ETF"},
    {"id": "a-silver", "code": "161226", "market": "0", "name": "白银LOF"},
    {"id": "a-metal", "code": "159980", "market": "0", "name": "有色金属ETF"},
]

CROSS_PAIRS = [
    {"gridId": "a-gold", "optionId": "opt-au", "correlation": 0.95, "basisRisk": "medium",
     "basisDescription": "ETF跟踪现货Au99.99，期权跟踪黄金期货", "hedgeEfficiency": 0.88},
    {"gridId": "a-doupo", "optionId": "opt-m", "correlation": 0.98, "basisRisk": "low",
     "basisDescription": "豆粕ETF跟踪豆粕期货价格指数", "hedgeEfficiency": 0.95},
    {"gridId": "a-silver", "optionId": "opt-ag", "correlation": 0.98, "basisRisk": "low",
     "basisDescription": "白银LOF与白银期权标的完全一致", "hedgeEfficiency": 0.96},
    {"gridId": "a-metal", "optionId": "opt-cu", "correlation": 0.85, "basisRisk": "medium",
     "basisDescription": "ETF跟踪有色金属期货指数，铜期权为单一品种近似对冲", "hedgeEfficiency": 0.80},
]


def json_response(data, status=200):
    """构造 JSON 响应"""
    body = json.dumps(data, ensure_ascii=False).encode('utf-8')
    headers = [
        ('Content-Type', 'application/json; charset=utf-8'),
        ('Access-Control-Allow-Origin', '*'),
        ('Content-Length', str(len(body))),
    ]
    return status, headers, [body]


def route(environ):
    """路由分发"""
    method = environ['REQUEST_METHOD']
    path = environ.get('PATH_INFO', '/').rstrip('/')

    # CORS 预检
    if method == 'OPTIONS':
        return 200, [('Access-Control-Allow-Origin', '*'), ('Access-Control-Allow-Methods', 'GET, OPTIONS')], [b'']

    # GET /api/health
    if path == '/api/health':
        return json_response({"status": "ok", "time": time.strftime("%Y-%m-%d %H:%M:%S")})

    # GET /api/grid-products
    if path == '/api/grid-products':
        results = []
        for p in ETF_PRODUCTS:
            snap = get_simulated_snapshot(p['code'])
            results.append({
                "id": p["id"], "code": p["code"], "name": p["name"],
                "market": p["market"],
                "live_price": snap["price"],
                "prev_close": snap["prev_close"],
                "change_pct": snap["change_pct"],
                "volume": snap["volume"],
                "simulated": True,
            })
        return json_response({"products": results, "count": len(results)})

    # GET /api/grid-products/{id}/snapshot
    if path.startswith('/api/grid-products/') and path.endswith('/snapshot'):
        product_id = path.split('/')[3]
        product = next((p for p in ETF_PRODUCTS if p["id"] == product_id), None)
        if not product:
            return json_response({"error": "not found"}, 404)

        # 尝试真实数据
        snap = None
        if _has_real_data:
            try:
                snap = get_etf_snapshot(product["code"], product["market"])
            except Exception:
                pass

        if not snap or "error" in snap:
            snap = get_simulated_snapshot(product["code"])

        return json_response({
            "id": product_id, "code": product["code"], "name": product["name"],
            "live_price": snap["price"],
            "prev_close": snap.get("prev_close"),
            "change_pct": snap.get("change_pct"),
            "high": snap.get("high"),
            "low": snap.get("low"),
            "volume": snap.get("volume"),
            "simulated": snap.get("simulated", True),
        })

    # GET /api/cross-pairs
    if path == '/api/cross-pairs':
        return json_response({"pairs": CROSS_PAIRS})

    return json_response({"error": "not found"}, 404)


def application(environ, start_response):
    """WSGI 入口"""
    try:
        status, headers, body = route(environ)
        start_response(f"{status} OK" if status == 200 else f"{status} Not Found", headers)
        return body
    except Exception as e:
        start_response("500 Internal Server Error", [('Content-Type', 'text/plain')])
        return [str(e).encode()]
