"""
跨市场策略控制台 - 后端 API 服务
提供实时行情数据接口
"""

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
import time

from eastmoney_client import get_etf_snapshot, get_etf_snapshots_batch
from simulated_data import get_simulated_snapshot
from akshare_client import (
    get_etf_history,
    get_option_list_sse,
    get_option_current_day_sse,
)

app = FastAPI(title="跨市场策略控制台 API", version="1.0.0")

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
    "opt-50": {"code": "510050", "name": "上证50ETF期权", "ak_name": "50ETF"},
    "opt-300": {"code": "510300", "name": "沪深300ETF期权(沪)", "ak_name": "300ETF"},
    "opt-300sz": {"code": "159919", "name": "沪深300ETF期权(深)", "ak_name": "300ETF"},
    "opt-500": {"code": "510500", "name": "中证500ETF期权", "ak_name": "500ETF"},
    "opt-kc50": {"code": "588000", "name": "科创50ETF期权", "ak_name": "科创50"},
}


# ==================== API 端点 ====================

@app.get("/api/health")
def health_check():
    """健康检查"""
    return {"status": "ok", "time": time.strftime("%Y-%m-%d %H:%M:%S")}


@app.get("/api/grid-products")
def list_grid_products():
    """
    返回所有 ETF 网格品种及其实时价格
    快速模式: 探测1个品种，3秒超时，失败则全部使用模拟数据
    """
    start = time.time()

    # 快速探测网络: 只测1个品种
    use_simulated = True
    test = ETF_PRODUCTS[0]
    snap = get_etf_snapshot(test["code"], test["market"])
    if "error" not in snap:
        use_simulated = False

    results = []
    for i, product in enumerate(ETF_PRODUCTS):
        if use_simulated:
            snap = get_simulated_snapshot(product["code"])
        else:
            snap = get_etf_snapshot(product["code"], product["market"])
            if "error" in snap:
                snap = get_simulated_snapshot(product["code"])

        live_price = snap.get("price", 0) if "error" not in snap else None

        item = {
            "id": product["id"],
            "code": product["code"],
            "name": product["name"],
            "market": product["market"],
            "live_price": live_price,
            "prev_close": snap.get("prev_close"),
            "change_pct": snap.get("change_pct"),
            "volume": snap.get("volume"),
            "error": None,
            "simulated": snap.get("simulated", False),
        }
        results.append(item)

    elapsed = time.time() - start
    return {"products": results, "count": len(results), "elapsed_ms": round(elapsed * 1000)}


@app.get("/api/grid-products/{product_id}/snapshot")
def get_grid_product_snapshot(product_id: str):
    """获取单个 ETF 品种的实时快照"""
    product = next((p for p in ETF_PRODUCTS if p["id"] == product_id), None)
    if not product:
        return {"error": "Unknown product", "id": product_id}

    snap = get_etf_snapshot(product["code"], product["market"])

    # 如果真实 API 失败，回退到模拟数据
    if "error" in snap:
        snap = get_simulated_snapshot(product["code"])

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
        "error": None,  # 模拟数据总是成功
        "simulated": snap.get("simulated", False),
    }


@app.get("/api/option-products")
def list_option_products():
    """返回期权品种列表及其实时标的物价格"""
    results = []

    # 获取上交所期权标的物实时价格 (失败时回退模拟数据)
    for opt_id, cfg in OPTION_UNDERLYINGS.items():
        snap = get_etf_snapshot(cfg["code"], "1")
        if "error" in snap:
            snap = get_simulated_snapshot(cfg["code"])

        results.append({
            "id": opt_id,
            "code": cfg["code"],
            "name": cfg["name"],
            "ak_name": cfg["ak_name"],
            "live_price": snap.get("price") if "error" not in snap else None,
            "change_pct": snap.get("change_pct") if "error" not in snap else None,
            "error": None,
            "simulated": snap.get("simulated", False),
        })

    # 港股 - 暂不获取实时数据
    results.append({
        "id": "opt-hstech",
        "code": "HSI",
        "name": "恒生科技指数期权",
        "live_price": None,
        "note": "港股指数期权需单独数据源",
    })

    # 商品期货期权 - 暂不获取实时数据
    commodity_opts = [
        {"id": "opt-au", "code": "AU", "name": "黄金期权"},
        {"id": "opt-ag", "code": "AG", "name": "白银期权"},
        {"id": "opt-cu", "code": "CU", "name": "铜期权"},
        {"id": "opt-m", "code": "M", "name": "豆粕期权"},
        {"id": "opt-rb", "code": "RB", "name": "螺纹钢期权"},
    ]
    for opt in commodity_opts:
        results.append({
            "id": opt["id"],
            "code": opt["code"],
            "name": opt["name"],
            "live_price": None,
            "note": "商品期货期权需期货行情接口",
        })

    return {"products": results, "count": len(results)}


@app.get("/api/option-products/{product_id}/chain")
def get_option_chain(product_id: str):
    """获取特定期权品种的合约链"""
    cfg = OPTION_UNDERLYINGS.get(product_id)
    if not cfg:
        return {"error": "Option chain not available for this product", "id": product_id}

    # 获取到期月份列表
    chain = get_option_list_sse(cfg["ak_name"])

    # 获取标的实时价格
    snap = get_etf_snapshot(cfg["code"], "1")

    return {
        "id": product_id,
        "underlying_code": cfg["code"],
        "underlying_price": snap.get("price") if "error" not in snap else None,
        "expiry_months": chain.get("expiry_months", []),
        "error": chain.get("error") if "error" in chain else None,
    }


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


# ==================== 启动 ====================

if __name__ == "__main__":
    import os
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print("=" * 60)
    print("  跨市场策略控制台 - 后端 API")
    print("  Cross-Market Strategy Console API")
    print("=" * 60)
    print()
    print("  ETF 品种数:", len(ETF_PRODUCTS))
    print("  期权品种数:", len(OPTION_UNDERLYINGS) + 6)
    print(f"  启动地址: http://0.0.0.0:{port}")
    print(f"  API 文档: http://0.0.0.0:{port}/docs")
    print()
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
