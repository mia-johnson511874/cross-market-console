"""
跨市场策略控制台 - PythonAnywhere WSGI 应用
提供与 FastAPI 版本相同的 API 端点

PythonAnywhere 免费账户限制:
  - 外部网络仅白名单站点可访问
  - 东方财富/a股数据 API 通常不可用
  - 使用模拟数据作为主要数据源
"""

import json
import sys
import os
import time
from urllib.parse import parse_qs

# 添加 backend 目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.chdir(os.path.dirname(os.path.abspath(__file__)))

# PythonAnywhere 代理设置
os.environ['http_proxy'] = 'http://proxy.server:8080'
os.environ['https_proxy'] = 'http://proxy.server:8080'

from simulated_data import get_simulated_snapshot, BASE_PRICES
from data import crossPairs

# 尝试导入真实行情客户端
try:
    from eastmoney_client import get_etf_snapshot
    _has_eastmoney = True
except Exception:
    _has_eastmoney = False

try:
    from yfinance_client import get_etf_snapshot_yfinance, check_yfinance_availability
    _has_yfinance = True
except Exception:
    _has_yfinance = False

try:
    from akshare_client import (
        get_etf_realtime_snapshot_akshare,
        get_option_list_sse,
        get_option_chain_with_prices,
        get_futures_price,
        get_hk_index_snapshot,
    )
    _has_akshare = True
except Exception:
    _has_akshare = False


# ---- ETF 品种配置 ----
ETF_PRODUCTS = [
    {"id": "a-hstech", "code": "513130", "market": "1", "name": "恒生科技ETF", "yf_symbol": "QQQ"},
    {"id": "a-hsient", "code": "513220", "market": "1", "name": "恒生互联网ETF", "yf_symbol": "KWEB"},
    {"id": "a-hsient2", "code": "513050", "market": "1", "name": "中概互联ETF", "yf_symbol": "KWEB"},
    {"id": "a-hsi", "code": "159920", "market": "0", "name": "恒生ETF", "yf_symbol": "EWH"},
    {"id": "a-hsi2", "code": "510900", "market": "1", "name": "H股ETF", "yf_symbol": "EWH"},
    {"id": "a-hkstock50", "code": "513120", "market": "1", "name": "港股通50ETF", "yf_symbol": "EWH"},
    {"id": "a-hkfinance", "code": "513190", "market": "1", "name": "港股通金融ETF", "yf_symbol": "EWH"},
    {"id": "a-hstech2", "code": "513600", "market": "1", "name": "恒生科技指数ETF", "yf_symbol": "QQQ"},
    {"id": "a-nasdaq", "code": "513100", "market": "1", "name": "纳指ETF", "yf_symbol": "QQQ"},
    {"id": "a-sp500", "code": "513500", "market": "1", "name": "标普500ETF", "yf_symbol": "SPY"},
    {"id": "a-nasdaq2", "code": "159941", "market": "0", "name": "纳指ETF深", "yf_symbol": "QQQ"},
    {"id": "a-nasdaq100", "code": "159659", "market": "0", "name": "纳斯达克100ETF", "yf_symbol": "QQQ"},
    {"id": "a-nasdaq3", "code": "159632", "market": "0", "name": "纳斯达克ETF沪", "yf_symbol": "QQQ"},
    {"id": "a-nikkei", "code": "159866", "market": "0", "name": "日经ETF", "yf_symbol": "EWJ"},
    {"id": "a-germany", "code": "513030", "market": "1", "name": "德国ETF", "yf_symbol": "EWG"},
    {"id": "a-gold", "code": "518880", "market": "1", "name": "黄金ETF", "yf_symbol": "GLD"},
    {"id": "a-gold2", "code": "159937", "market": "0", "name": "黄金ETF深", "yf_symbol": "GLD"},
    {"id": "a-doupo", "code": "159985", "market": "0", "name": "豆粕ETF", "yf_symbol": "SOYB"},
    {"id": "a-silver", "code": "161226", "market": "0", "name": "白银LOF", "yf_symbol": "SLV"},
    {"id": "a-metal", "code": "159980", "market": "0", "name": "有色金属ETF", "yf_symbol": "COPX"},
    {"id": "us-cny", "code": "CYB", "market": "US", "name": "人民币ETF", "yf_symbol": "CYB"},
    {"id": "us-ashr", "code": "ASHR", "market": "US", "name": "沪深300ETF(美股)", "yf_symbol": "ASHR"},
    {"id": "us-qqq", "code": "QQQ", "market": "US", "name": "纳指ETF(美股)", "yf_symbol": "QQQ"},
    {"id": "us-spy", "code": "SPY", "market": "US", "name": "标普500ETF(美股)", "yf_symbol": "SPY"},
    {"id": "us-ewh", "code": "EWH", "market": "US", "name": "恒生ETF(美股)", "yf_symbol": "EWH"},
    {"id": "us-kweb", "code": "KWEB", "market": "US", "name": "中国互联网ETF(美股)", "yf_symbol": "KWEB"},
    {"id": "us-cqqq", "code": "CQQQ", "market": "US", "name": "中国科技ETF(美股)", "yf_symbol": "CQQQ"},
]

# 期权标的映射
OPTION_UNDERLYINGS = {
    "opt-50":   {"code": "510050", "name": "上证50ETF期权", "ak_name": "50ETF"},
    "opt-300":  {"code": "510300", "name": "沪深300ETF期权(沪)", "ak_name": "300ETF"},
    "opt-300sz": {"code": "159919", "name": "沪深300ETF期权(深)", "ak_name": "300ETF"},
    "opt-500":  {"code": "510500", "name": "中证500ETF期权", "ak_name": "500ETF"},
    "opt-kc50": {"code": "588000", "name": "科创50ETF期权", "ak_name": "科创50"},
}

COMMODITY_OPTIONS = {
    "opt-au": {"code": "AU", "name": "黄金期权", "future_symbol": "AU"},
    "opt-ag": {"code": "AG", "name": "白银期权", "future_symbol": "AG"},
    "opt-cu": {"code": "CU", "name": "铜期权", "future_symbol": "CU"},
    "opt-m":  {"code": "M",  "name": "豆粕期权", "future_symbol": "M"},
    "opt-rb": {"code": "RB", "name": "螺纹钢期权", "future_symbol": "RB"},
}

HK_OPTIONS = {
    "opt-hstech": {"code": "HSI", "name": "恒生科技指数期权", "index_code": "HSTECH"},
}

# CORS 允许的域名
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://comforting-gelato-60631d.netlify.app",
    "https://jxsongy648077168.pythonanywhere.com",
]


# ==================== 数据获取 ====================

def _fetch_etf_snapshot(code: str, market: str = "1", yf_symbol: str = "") -> dict:
    """获取 ETF 快照: 东方财富 → Yahoo Finance → akshare → 模拟"""
    if _has_eastmoney:
        snap = get_etf_snapshot(code, market)
        if "error" not in snap:
            snap["source"] = "eastmoney"
            return snap

    if _has_yfinance:
        symbol_to_use = yf_symbol if yf_symbol else code
        snap = get_etf_snapshot_yfinance(symbol_to_use, market)
        if "error" not in snap:
            snap["source"] = "yfinance"
            return snap

    if _has_akshare:
        snap = get_etf_realtime_snapshot_akshare(code)
        if "error" not in snap:
            snap["source"] = "akshare"
            return snap

    snap = get_simulated_snapshot(code)
    snap["source"] = "simulated"
    return snap


# ==================== HTTP 工具 ====================

def json_response(data, status=200):
    """构造 JSON 响应"""
    body = json.dumps(data, ensure_ascii=False).encode('utf-8')
    headers = [
        ('Content-Type', 'application/json; charset=utf-8'),
        ('Access-Control-Allow-Origin', '*'),
        ('Access-Control-Allow-Methods', 'GET, OPTIONS'),
        ('Access-Control-Allow-Headers', 'Content-Type'),
        ('Content-Length', str(len(body))),
    ]
    return status, headers, [body]


def get_path_parts(path: str) -> list[str]:
    """解析路径"""
    return [p for p in path.rstrip('/').split('/') if p]


# ==================== API 路由 ====================

def route_api(path: str, qs: str = "") -> tuple:
    """API 路由分发"""
    parts = get_path_parts(path)
    query = parse_qs(qs)

    # GET /api/health
    if len(parts) >= 2 and parts[0] == 'api' and parts[1] == 'health':
        return json_response({
            "status": "ok",
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "akshare_available": _has_akshare,
            "eastmoney_available": _has_eastmoney,
            "yfinance_available": _has_yfinance,
        })

    # GET /api/data-sources
    if len(parts) >= 2 and parts[0] == 'api' and parts[1] == 'data-sources':
        sources = {
            "eastmoney": {"available": False, "latency_ms": 0},
            "yfinance": {"available": False, "latency_ms": 0},
            "akshare_etf": {"available": False, "latency_ms": 0},
            "akshare_futures": {"available": False, "latency_ms": 0},
            "akshare_hk_index": {"available": False, "latency_ms": 0},
            "akshare_options": {"available": False, "latency_ms": 0},
        }
        if _has_eastmoney:
            t0 = time.time()
            snap = get_etf_snapshot("513100", "1")
            sources["eastmoney"] = {
                "available": "error" not in snap,
                "latency_ms": round((time.time() - t0) * 1000),
            }
        if _has_yfinance:
            sources["yfinance"] = check_yfinance_availability()
        if _has_akshare:
            try:
                from akshare_client import check_akshare_availability
                aks = check_akshare_availability()
                sources["akshare_etf"] = aks.get("etf_history", {"available": False})
                sources["akshare_futures"] = aks.get("futures", {"available": False})
                sources["akshare_hk_index"] = aks.get("hk_index", {"available": False})
                sources["akshare_options"] = aks.get("option_sse", {"available": False})
            except Exception:
                pass

        any_real = sources["eastmoney"]["available"] or sources["yfinance"]["available"] or sources["akshare_etf"]["available"]
        return json_response({
            "sources": sources,
            "any_real_data": any_real,
            "mode": "live" if any_real else "simulated",
            "checked_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        })

    # GET /api/grid-products
    if len(parts) >= 2 and parts[0] == 'api' and parts[1] == 'grid-products' and len(parts) == 2:
        start = time.time()
        results = []
        for p in ETF_PRODUCTS:
            snap = _fetch_etf_snapshot(p["code"], p["market"], p.get("yf_symbol", ""))
            live_price = snap.get("price") if "error" not in snap else None
            results.append({
                "id": p["id"], "code": p["code"], "name": p["name"],
                "market": p["market"],
                "live_price": live_price,
                "prev_close": snap.get("prev_close"),
                "change_pct": snap.get("change_pct"),
                "volume": snap.get("volume"),
                "error": None,
                "simulated": snap.get("simulated", snap.get("source") == "simulated"),
                "source": snap.get("source", "simulated"),
            })

        elapsed = time.time() - start
        return json_response({
            "products": results, "count": len(results),
            "elapsed_ms": round(elapsed * 1000),
        })

    # GET /api/grid-products/{id}/snapshot
    if len(parts) >= 4 and parts[0] == 'api' and parts[1] == 'grid-products' and parts[3] == 'snapshot':
        product_id = parts[2]
        product = next((p for p in ETF_PRODUCTS if p["id"] == product_id), None)
        if not product:
            return json_response({"error": "Unknown product", "id": product_id}, 404)

        snap = _fetch_etf_snapshot(product["code"], product["market"], product.get("yf_symbol", ""))
        return json_response({
            "id": product_id, "code": product["code"], "name": product["name"],
            "live_price": snap.get("price") if "error" not in snap else None,
            "prev_close": snap.get("prev_close"),
            "change_pct": snap.get("change_pct"),
            "high": snap.get("high"),
            "low": snap.get("low"),
            "volume": snap.get("volume"),
            "error": None,
            "simulated": snap.get("simulated", snap.get("source") == "simulated"),
            "source": snap.get("source", "simulated"),
        })

    # GET /api/option-products
    if len(parts) >= 2 and parts[0] == 'api' and parts[1] == 'option-products' and len(parts) == 2:
        results = []

        # ETF 期权
        for opt_id, cfg in OPTION_UNDERLYINGS.items():
            snap = _fetch_etf_snapshot(cfg["code"])
            results.append({
                "id": opt_id, "code": cfg["code"], "name": cfg["name"],
                "ak_name": cfg["ak_name"],
                "live_price": snap.get("price") if "error" not in snap else None,
                "change_pct": snap.get("change_pct") if "error" not in snap else None,
                "error": None,
                "simulated": snap.get("simulated", snap.get("source") == "simulated"),
                "source": snap.get("source", "simulated"),
            })

        # 港股指数期权
        for opt_id, cfg in HK_OPTIONS.items():
            live_price = None
            source = "simulated"
            if _has_akshare:
                hk = get_hk_index_snapshot(cfg["index_code"])
                if "error" not in hk:
                    live_price = hk.get("price")
                    source = hk.get("source", "akshare")
            results.append({
                "id": opt_id, "code": cfg["code"], "name": cfg["name"],
                "live_price": live_price, "change_pct": None,
                "error": None, "simulated": source == "simulated", "source": source,
            })

        # 商品期货期权
        for opt_id, cfg in COMMODITY_OPTIONS.items():
            live_price = None
            source = "simulated"
            if _has_akshare:
                fut = get_futures_price(cfg["future_symbol"])
                if "error" not in fut:
                    live_price = fut.get("price")
                    source = fut.get("source", "akshare")
            results.append({
                "id": opt_id, "code": cfg["code"], "name": cfg["name"],
                "live_price": live_price, "change_pct": None,
                "error": None, "simulated": source == "simulated",
                "source": source, "future_symbol": cfg["future_symbol"],
            })

        return json_response({"products": results, "count": len(results)})

    # GET /api/option-products/{id}/chain
    if len(parts) >= 4 and parts[0] == 'api' and parts[1] == 'option-products' and parts[3] == 'chain':
        product_id = parts[2]

        # ETF 期权
        cfg = OPTION_UNDERLYINGS.get(product_id)
        if cfg:
            snap = _fetch_etf_snapshot(cfg["code"])
            result = {
                "id": product_id, "underlying_code": cfg["code"],
                "underlying_name": cfg["name"],
                "underlying_price": snap.get("price") if "error" not in snap else None,
                "expiry_months": [], "contracts": [], "error": None,
            }
            if _has_akshare:
                try:
                    chain_data = get_option_chain_with_prices(cfg["code"], cfg["ak_name"])
                    result["expiry_months"] = chain_data.get("expiry_months", [])
                    result["contracts"] = chain_data.get("contracts", [])
                    if chain_data.get("error"):
                        result["error"] = chain_data["error"]
                except Exception:
                    result["error"] = "Option chain unavailable"
            return json_response(result)

        # 商品期货期权
        comm_cfg = COMMODITY_OPTIONS.get(product_id)
        if comm_cfg:
            result = {
                "id": product_id, "underlying_code": comm_cfg["code"],
                "underlying_name": comm_cfg["name"],
                "underlying_price": None, "expiry_months": [], "contracts": [],
                "note": "商品期货期权合约链需通过期货公司 API 获取 (CTP/飞马等)",
                "error": None,
            }
            if _has_akshare:
                try:
                    fut = get_futures_price(comm_cfg["future_symbol"])
                    if "error" not in fut:
                        result["underlying_price"] = fut.get("price")
                        result["underlying_change_pct"] = fut.get("change_pct")
                except Exception:
                    pass
            return json_response(result)

        # 港股指数期权
        hk_cfg = HK_OPTIONS.get(product_id)
        if hk_cfg:
            result = {
                "id": product_id, "underlying_code": hk_cfg["code"],
                "underlying_name": hk_cfg["name"],
                "underlying_price": None, "expiry_months": [], "contracts": [],
                "note": "港股指数期权合约链需接入港交所 OMID 或券商 API",
                "error": None,
            }
            if _has_akshare:
                try:
                    hk = get_hk_index_snapshot(hk_cfg["index_code"])
                    if "error" not in hk:
                        result["underlying_price"] = hk.get("price")
                        result["underlying_change_pct"] = hk.get("change_pct")
                except Exception:
                    pass
            return json_response(result)

        return json_response({"error": "Unknown product", "id": product_id}, 404)

    # GET /api/cross-pairs
    if len(parts) >= 2 and parts[0] == 'api' and parts[1] == 'cross-pairs':
        pairs_data = [
            {
                "gridId": p["gridId"], "optionId": p["optionId"],
                "correlation": p["correlation"], "basisRisk": p["basisRisk"],
                "basisDescription": p["basisDescription"],
                "hedgeEfficiency": p["hedgeEfficiency"],
            }
            for p in crossPairs
        ]
        return json_response({"pairs": pairs_data, "count": len(pairs_data)})

    return json_response({"error": "not found"}, 404)


# ==================== WSGI 入口 ====================

def application(environ, start_response):
    """WSGI 入口"""
    method = environ.get('REQUEST_METHOD', 'GET')
    path = environ.get('PATH_INFO', '/')
    qs = environ.get('QUERY_STRING', '')

    # CORS 预检
    if method == 'OPTIONS':
        headers = [
            ('Access-Control-Allow-Origin', '*'),
            ('Access-Control-Allow-Methods', 'GET, OPTIONS'),
            ('Access-Control-Allow-Headers', 'Content-Type'),
            ('Content-Length', '0'),
        ]
        start_response('200 OK', headers)
        return [b'']

    # API 路由
    if path.startswith('/api/'):
        try:
            status, headers, body = route_api(path, qs)
            status_text = (
                '200 OK' if status == 200 else
                '404 Not Found' if status == 404 else
                '500 Internal Server Error'
            )
            start_response(status_text, headers)
            return body
        except Exception as e:
            start_response('500 Internal Server Error', [
                ('Content-Type', 'text/plain; charset=utf-8'),
                ('Access-Control-Allow-Origin', '*'),
            ])
            return [f"Internal Server Error: {e}".encode('utf-8')]

    # 非 API 路径
    start_response('404 Not Found', [
        ('Content-Type', 'text/plain; charset=utf-8'),
        ('Access-Control-Allow-Origin', '*'),
    ])
    return [b'Not Found']
