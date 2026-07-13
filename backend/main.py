"""
跨市场策略控制台 - 后端 API 服务
提供实时行情数据接口

数据源优先级: 东方财富 → akshare → 模拟数据
"""

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from eastmoney_client import get_etf_snapshot, get_etf_snapshots_batch, get_etf_snapshots_batch_eastmoney
from simulated_data import get_simulated_snapshot

# ---- 可选/分层导入 ----
# 东方财富直连 — 这个是主要的实时数据源，必须可用
_has_eastmoney = True  # eastmoney_client 总是可用

# akshare — 可选增强数据源 (期货、期权链、港股指数)
try:
    from akshare_client import (
        get_etf_history,
        get_etf_realtime_snapshot_akshare,
        get_option_list_sse,
        get_option_current_day_sse,
        get_option_chain_with_prices,
        get_futures_price,
        get_futures_prices_batch,
        get_hk_index_snapshot,
        check_akshare_availability,
    )
    _has_akshare = True
    logger.info("akshare client loaded successfully")
except ImportError:
    _has_akshare = False
    logger.warning("akshare not installed — futures, options chain, HK index unavailable")

app = FastAPI(title="跨市场策略控制台 API", version="1.1.0")

# CORS - 允许前端跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- ETF 品种配置 (与前端 gridProducts.ts 保持一致) ----
ETF_PRODUCTS = [
    # 港股跨境ETF
    {"id": "a-hstech", "code": "513130", "market": "1", "name": "恒生科技ETF"},
    {"id": "a-hsient", "code": "513220", "market": "1", "name": "恒生互联网ETF"},
    {"id": "a-hsient2", "code": "513050", "market": "1", "name": "中概互联ETF"},
    {"id": "a-hsi", "code": "159920", "market": "0", "name": "恒生ETF"},
    {"id": "a-hsi2", "code": "510900", "market": "1", "name": "H股ETF"},
    {"id": "a-hkstock50", "code": "513120", "market": "1", "name": "港股通50ETF"},
    {"id": "a-hkfinance", "code": "513190", "market": "1", "name": "港股通金融ETF"},
    {"id": "a-hstech2", "code": "513600", "market": "1", "name": "恒生科技指数ETF"},
    # 美股跨境ETF
    {"id": "a-nasdaq", "code": "513100", "market": "1", "name": "纳指ETF"},
    {"id": "a-sp500", "code": "513500", "market": "1", "name": "标普500ETF"},
    {"id": "a-nasdaq2", "code": "159941", "market": "0", "name": "纳指ETF深"},
    {"id": "a-nasdaq100", "code": "159659", "market": "0", "name": "纳斯达克100ETF"},
    {"id": "a-nasdaq3", "code": "159632", "market": "0", "name": "纳斯达克ETF沪"},
    # 其他跨境ETF
    {"id": "a-nikkei", "code": "159866", "market": "0", "name": "日经ETF"},
    {"id": "a-germany", "code": "513030", "market": "1", "name": "德国ETF"},
    # 商品ETF/LOF
    {"id": "a-gold", "code": "518880", "market": "1", "name": "黄金ETF"},
    {"id": "a-gold2", "code": "159937", "market": "0", "name": "黄金ETF深"},
    {"id": "a-doupo", "code": "159985", "market": "0", "name": "豆粕ETF"},
    {"id": "a-silver", "code": "161226", "market": "0", "name": "白银LOF"},
    {"id": "a-metal", "code": "159980", "market": "0", "name": "有色金属ETF"},
]

# 期权标的映射
OPTION_UNDERLYINGS = {
    "opt-50":   {"code": "510050", "name": "上证50ETF期权", "ak_name": "50ETF"},
    "opt-300":  {"code": "510300", "name": "沪深300ETF期权(沪)", "ak_name": "300ETF"},
    "opt-300sz": {"code": "159919", "name": "沪深300ETF期权(深)", "ak_name": "300ETF"},
    "opt-500":  {"code": "510500", "name": "中证500ETF期权", "ak_name": "500ETF"},
    "opt-kc50": {"code": "588000", "name": "科创50ETF期权", "ak_name": "科创50"},
}

# 商品期货期权 → 期货品种映射
COMMODITY_OPTIONS = {
    "opt-au": {"code": "AU", "name": "黄金期权", "future_symbol": "AU"},
    "opt-ag": {"code": "AG", "name": "白银期权", "future_symbol": "AG"},
    "opt-cu": {"code": "CU", "name": "铜期权", "future_symbol": "CU"},
    "opt-m":  {"code": "M",  "name": "豆粕期权", "future_symbol": "M"},
    "opt-rb": {"code": "RB", "name": "螺纹钢期权", "future_symbol": "RB"},
}

# 港股指数期权映射
HK_OPTIONS = {
    "opt-hstech": {
        "code": "HSI",
        "name": "恒生科技指数期权",
        "index_code": "HSTECH",
    },
}


# ---- 全局数据源可用性缓存 ----
# 只缓存 True（东方财富可用），不缓存 False，避免偶发网络抖动导致长期降级。
# 但会记录最近一次失败时间，在冷却期内快速跳过东方财富，避免每个请求都超时。
_eastmoney_available_cache: Optional[bool] = None
_eastmoney_last_failure: float = 0.0
_EASTMONEY_COOLDOWN_SECONDS = 60


def _check_eastmoney_quick(max_retries: int = 2) -> bool:
    """
    快速检测东方财富 API 是否可用。
    仅当确认可用时才缓存 True；失败时记录时间，冷却期内不再重复探测。
    """
    global _eastmoney_available_cache, _eastmoney_last_failure
    if _eastmoney_available_cache is True:
        return True

    # 冷却期内快速跳过
    if (time.time() - _eastmoney_last_failure) < _EASTMONEY_COOLDOWN_SECONDS:
        return False

    test = ETF_PRODUCTS[0]
    for attempt in range(max_retries):
        snap = get_etf_snapshot(test["code"], test["market"])
        if "error" not in snap:
            _eastmoney_available_cache = True
            return True
        if attempt < max_retries - 1:
            time.sleep(0.3)

    _eastmoney_last_failure = time.time()
    return False


# ==================== 数据获取辅助函数 ====================

def _fetch_etf_snapshot_with_fallback(code: str, market: str) -> dict:
    """
    获取 ETF 快照，带多级回退:
      1. 东方财富 API (主)
      2. akshare 接口 (备)
      3. 模拟数据 (兜底)
    """
    # 第1级: 东方财富 (仅当全局检测可用时才尝试，避免每个请求都超时)
    if _check_eastmoney_quick():
        snap = get_etf_snapshot(code, market)
        if "error" not in snap:
            snap["source"] = "eastmoney"
            # 成功后更新全局可用性缓存
            global _eastmoney_available_cache
            _eastmoney_available_cache = True
            return snap

    # 第2级: akshare
    if _has_akshare:
        snap = get_etf_realtime_snapshot_akshare(code)
        if "error" not in snap:
            snap["source"] = "akshare"
            return snap

    # 第3级: 模拟数据
    snap = get_simulated_snapshot(code)
    snap["source"] = "simulated"
    return snap


def _fetch_underlying_price(code: str, market: str = "1") -> dict:
    """获取 ETF 期权标的物实时价格"""
    return _fetch_etf_snapshot_with_fallback(code, market)


def _fetch_one_grid_product(product: dict, try_eastmoney: bool = True) -> dict:
    """获取单个网格品种数据（用于并发批量接口）"""
    if try_eastmoney:
        snap = _fetch_etf_snapshot_with_fallback(product["code"], product["market"])
    elif _has_akshare:
        snap = get_etf_realtime_snapshot_akshare(product["code"])
        if "error" not in snap:
            snap["source"] = "akshare"
        else:
            snap = get_simulated_snapshot(product["code"])
            snap["source"] = "simulated"
    else:
        snap = get_simulated_snapshot(product["code"])
        snap["source"] = "simulated"
    return {
        "id": product["id"],
        "code": product["code"],
        "name": product["name"],
        "market": product["market"],
        "live_price": snap.get("price") if "error" not in snap else None,
        "prev_close": snap.get("prev_close"),
        "change_pct": snap.get("change_pct"),
        "volume": snap.get("volume"),
        "error": None,
        "simulated": snap.get("simulated", snap.get("source") == "simulated"),
        "source": snap.get("source", "simulated"),
    }


# ==================== API 端点 ====================

@app.get("/api/health")
def health_check():
    """健康检查"""
    return {
        "status": "ok",
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "akshare_available": _has_akshare,
        "eastmoney_available": _has_eastmoney,
    }


@app.get("/api/data-sources")
def check_data_sources():
    """
    诊断端点: 检测所有数据源的可用性
    前端可据此判断当前行情数据来源
    """
    results = {
        "eastmoney": {"available": False, "latency_ms": 0},
        "akshare_etf": {"available": False, "latency_ms": 0},
        "akshare_futures": {"available": False, "latency_ms": 0},
        "akshare_hk_index": {"available": False, "latency_ms": 0},
        "akshare_options": {"available": False, "latency_ms": 0},
    }

    # 测试东方财富
    t0 = time.time()
    snap = get_etf_snapshot("513100", "1")
    results["eastmoney"] = {
        "available": "error" not in snap,
        "latency_ms": round((time.time() - t0) * 1000),
    }

    # 测试 akshare 各子模块
    if _has_akshare:
        akshare_status = check_akshare_availability()
        results["akshare_etf"] = akshare_status.get("etf_history", {"available": False})
        results["akshare_futures"] = akshare_status.get("futures", {"available": False})
        results["akshare_hk_index"] = akshare_status.get("hk_index", {"available": False})
        results["akshare_options"] = akshare_status.get("option_sse", {"available": False})

    # 汇总: 是否有任何真实数据源可用
    any_real = (
        results["eastmoney"]["available"]
        or results["akshare_etf"]["available"]
    )

    return {
        "sources": results,
        "any_real_data": any_real,
        "mode": "live" if any_real else "simulated",
        "checked_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def _build_grid_product(product: dict, snap: dict) -> dict:
    """根据快照数据构造 grid product 响应项"""
    return {
        "id": product["id"],
        "code": product["code"],
        "name": product["name"],
        "market": product["market"],
        "live_price": snap.get("price") if "error" not in snap else None,
        "prev_close": snap.get("prev_close"),
        "change_pct": snap.get("change_pct"),
        "volume": snap.get("volume"),
        "error": snap.get("error") if "error" in snap else None,
        "simulated": snap.get("simulated", snap.get("source") == "simulated"),
        "source": snap.get("source", "simulated"),
    }


@app.get("/api/grid-products")
def list_grid_products():
    """
    返回所有 ETF 网格品种及其实时价格
    优先东方财富批量接口，不可用时回退 akshare，最终兜底模拟数据
    """
    start = time.time()
    results: list[dict] = []

    # 第1级: 东方财富批量接口（一次性拉取全部，通常在 1-2 秒内完成）
    batch = get_etf_snapshots_batch_eastmoney(ETF_PRODUCTS)
    if batch and "error" not in batch[0]:
        code_to_snap = {snap["code"]: snap for snap in batch if "code" in snap}
        results = [_build_grid_product(p, code_to_snap.get(p["code"], {"error": "missing"})) for p in ETF_PRODUCTS]
    else:
        # 第2级: akshare 全量 ETF 列表
        if _has_akshare:
            snaps = {p["code"]: get_etf_realtime_snapshot_akshare(p["code"]) for p in ETF_PRODUCTS}
            results = [_build_grid_product(p, snaps.get(p["code"], {"error": "missing"})) for p in ETF_PRODUCTS]
        else:
            # 第3级: 模拟数据
            results = [
                _build_grid_product(p, {**get_simulated_snapshot(p["code"]), "source": "simulated"})
                for p in ETF_PRODUCTS
            ]

    elapsed = time.time() - start
    return {"products": results, "count": len(results), "elapsed_ms": round(elapsed * 1000)}


@app.get("/api/grid-products/{product_id}/snapshot")
def get_grid_product_snapshot(product_id: str):
    """获取单个 ETF 品种的实时快照"""
    product = next((p for p in ETF_PRODUCTS if p["id"] == product_id), None)
    if not product:
        return {"error": "Unknown product", "id": product_id}

    snap = _fetch_etf_snapshot_with_fallback(product["code"], product["market"])

    return {
        "id": product_id,
        "code": product["code"],
        "name": product["name"],
        "live_price": snap.get("price") if "error" not in snap else None,
        "prev_close": snap.get("prev_close"),
        "change_pct": snap.get("change_pct"),
        "high": snap.get("high"),
        "low": snap.get("low"),
        "volume": snap.get("volume"),
        "error": None,
        "simulated": snap.get("simulated", snap.get("source") == "simulated"),
        "source": snap.get("source", "simulated"),
    }


@app.get("/api/option-products")
def list_option_products():
    """
    返回期权品种列表及其实时标的物价格
    包含: ETF期权标的、商品期货、港股指数
    """
    results = []

    # ---- ETF 期权: 通过东方财富/akshare 获取标的物实时价格 ----
    for opt_id, cfg in OPTION_UNDERLYINGS.items():
        snap = _fetch_underlying_price(cfg["code"])
        results.append({
            "id": opt_id,
            "code": cfg["code"],
            "name": cfg["name"],
            "ak_name": cfg["ak_name"],
            "live_price": snap.get("price") if "error" not in snap else None,
            "change_pct": snap.get("change_pct") if "error" not in snap else None,
            "error": None,
            "simulated": snap.get("simulated", snap.get("source") == "simulated"),
            "source": snap.get("source", "simulated"),
        })

    # ---- 港股指数期权: 通过 akshare 获取恒生科技指数 ----
    for opt_id, cfg in HK_OPTIONS.items():
        live_price = None
        change_pct = None
        simulated = True
        source = "simulated"

        if _has_akshare:
            hk_snap = get_hk_index_snapshot(cfg["index_code"])
            if "error" not in hk_snap:
                live_price = hk_snap.get("price")
                change_pct = hk_snap.get("change_pct")
                simulated = False
                source = hk_snap.get("source", "akshare")
            else:
                # 港股指数拿不到真实数据时，使用前端静态价格
                pass

        results.append({
            "id": opt_id,
            "code": cfg["code"],
            "name": cfg["name"],
            "live_price": live_price,
            "change_pct": change_pct,
            "error": None,
            "simulated": simulated,
            "source": source,
        })

    # ---- 商品期货期权: 通过 akshare 获取期货实时行情 ----
    for opt_id, cfg in COMMODITY_OPTIONS.items():
        live_price = None
        change_pct = None
        simulated = True
        source = "simulated"

        if _has_akshare:
            fut = get_futures_price(cfg["future_symbol"])
            if "error" not in fut:
                live_price = fut.get("price")
                change_pct = fut.get("change_pct")
                simulated = False
                source = fut.get("source", "akshare")
            else:
                # 期货拿不到真实数据时回退模拟
                pass

        results.append({
            "id": opt_id,
            "code": cfg["code"],
            "name": cfg["name"],
            "live_price": live_price,
            "change_pct": change_pct,
            "error": None,
            "simulated": simulated,
            "source": source,
            "future_symbol": cfg["future_symbol"],
        })

    return {"products": results, "count": len(results)}


@app.get("/api/option-products/{product_id}/chain")
def get_option_chain(product_id: str):
    """
    获取特定期权品种的合约链 (到期月份 + 当前交易日实时合约行情)

    支持的品种:
      - ETF期权 (opt-50, opt-300, opt-300sz, opt-500, opt-kc50)
      - 商品期权 (opt-au, opt-ag, opt-cu, opt-m, opt-rb)
      - 港股指数期权 (opt-hstech)
    """

    # --- ETF 期权 ---
    cfg = OPTION_UNDERLYINGS.get(product_id)
    if cfg:
        # 获取标的实时价格
        snap = _fetch_underlying_price(cfg["code"])

        result = {
            "id": product_id,
            "underlying_code": cfg["code"],
            "underlying_name": cfg["name"],
            "underlying_price": snap.get("price") if "error" not in snap else None,
            "expiry_months": [],
            "contracts": [],
            "error": None,
        }

        if _has_akshare:
            chain_data = get_option_chain_with_prices(cfg["code"], cfg["ak_name"])
            result["expiry_months"] = chain_data.get("expiry_months", [])
            result["contracts"] = chain_data.get("contracts", [])
            if chain_data.get("error"):
                result["error"] = chain_data["error"]
        else:
            # 无 akshare: 只返回到期月份 (走旧的函数)
            chain = get_option_list_sse(cfg["ak_name"]) if _has_akshare else {}
            result["expiry_months"] = chain.get("expiry_months", [])
            result["error"] = chain.get("error") if "error" in chain else "akshare not installed"

        return result

    # --- 商品期货期权 ---
    comm_cfg = COMMODITY_OPTIONS.get(product_id)
    if comm_cfg:
        result = {
            "id": product_id,
            "underlying_code": comm_cfg["code"],
            "underlying_name": comm_cfg["name"],
            "underlying_price": None,
            "expiry_months": [],
            "contracts": [],
            "note": "商品期货期权合约链需通过期货公司 API 获取 (CTP/飞马等)",
            "error": None,
        }

        if _has_akshare:
            fut = get_futures_price(comm_cfg["future_symbol"])
            if "error" not in fut:
                result["underlying_price"] = fut.get("price")
                result["underlying_change_pct"] = fut.get("change_pct")

        return result

    # --- 港股指数期权 ---
    hk_cfg = HK_OPTIONS.get(product_id)
    if hk_cfg:
        result = {
            "id": product_id,
            "underlying_code": hk_cfg["code"],
            "underlying_name": hk_cfg["name"],
            "underlying_price": None,
            "expiry_months": [],
            "contracts": [],
            "note": "港股指数期权合约链需接入港交所 OMID 或券商 API",
            "error": None,
        }

        if _has_akshare:
            hk_snap = get_hk_index_snapshot(hk_cfg["index_code"])
            if "error" not in hk_snap:
                result["underlying_price"] = hk_snap.get("price")
                result["underlying_change_pct"] = hk_snap.get("change_pct")

        return result

    return {"error": "Unknown product", "id": product_id}


@app.get("/api/cross-pairs")
def list_cross_pairs():
    """返回跨品种配对关系 (静态配置)"""
    from data import crossPairs

    pairs_data = [
        {
            "gridId": p["gridId"],
            "optionId": p["optionId"],
            "correlation": p["correlation"],
            "basisRisk": p["basisRisk"],
            "basisDescription": p["basisDescription"],
            "hedgeEfficiency": p["hedgeEfficiency"],
        }
        for p in crossPairs
    ]
    return {"pairs": pairs_data, "count": len(pairs_data)}


def _warmup_akshare_cache():
    """
    启动时预热 akshare ETF 全量缓存。
    这样 /api/grid-products 首次请求也能快速命中缓存。
    """
    if not _has_akshare or not ETF_PRODUCTS:
        return
    try:
        t0 = time.time()
        logger.info("Warming up akshare ETF cache...")
        get_etf_realtime_snapshot_akshare(ETF_PRODUCTS[0]["code"])
        logger.info(f"Akshare ETF cache warmed up in {(time.time() - t0):.1f}s")
    except Exception as e:
        logger.warning(f"Failed to warm up akshare cache: {e}")


# ==================== 启动 ====================

if __name__ == "__main__":
    import os
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    print("=" * 60)
    print("  跨市场策略控制台 - 后端 API  v1.1")
    print("  Cross-Market Strategy Console API")
    print("=" * 60)
    print()
    print(f"  ETF 品种数:     {len(ETF_PRODUCTS)}")
    print(f"  期权品种数:     {len(OPTION_UNDERLYINGS) + len(COMMODITY_OPTIONS) + len(HK_OPTIONS)}")
    print(f"    - ETF期权:    {len(OPTION_UNDERLYINGS)}")
    print(f"    - 商品期货期权: {len(COMMODITY_OPTIONS)}")
    print(f"    - 港股指数期权: {len(HK_OPTIONS)}")
    print(f"  数据源:")
    print(f"    - 东方财富 API: {'可用' if _has_eastmoney else '不可用'}")
    print(f"    - akshare:     {'可用' if _has_akshare else '不可用'}")
    print(f"    - 模拟数据:     可用 (兜底)")
    print(f"  启动地址: http://0.0.0.0:{port}")
    print(f"  API 文档: http://0.0.0.0:{port}/docs")
    print(f"  诊断端点: http://0.0.0.0:{port}/api/data-sources")
    print()
    print("=" * 60)

    # 预热缓存（可能需要 10-30 秒，取决于网络）
    _warmup_akshare_cache()

    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
