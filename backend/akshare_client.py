"""
Akshare 数据客户端
用于获取历史数据、期权链、期货行情、港股指数等结构化数据

数据源覆盖:
  - ETF 历史 K 线 (东方财富)
  - ETF 实时快照 (新浪/东方财富备用)
  - 上交所 ETF 期权合约链
  - 商品期货实时行情
  - 港股指数实时行情
"""

import akshare as ak
from typing import Optional
import time
import logging
import threading

logger = logging.getLogger(__name__)

# 缓存
_cache: dict[str, dict] = {}
_cache_ttl = 30

# 防止多个线程并发请求同一份 akshare 全量 ETF 数据
_ak_etf_lock = threading.Lock()


def _cached(key: str, ttl: int = None):
    """读取缓存，返回缓存的数据或 None"""
    if ttl is None:
        ttl = _cache_ttl
    entry = _cache.get(key)
    if entry is not None:
        ts = entry.get("_ts", 0) if isinstance(entry, dict) else 0
        if (time.time() - ts) < ttl:
            if isinstance(entry, dict):
                return {k: v for k, v in entry.items() if k != "_ts"}
            return entry  # 非 dict 类型(如 DataFrame)直接返回
    return None


def _set_cache(key: str, data):
    """写入缓存。data 可以是 dict 或 DataFrame 等任意类型"""
    if isinstance(data, dict):
        data["_ts"] = time.time()
        _cache[key] = data
        return {k: v for k, v in data.items() if k != "_ts"}
    else:
        # 非 dict 类型(如 DataFrame): 包装后缓存
        _cache[key] = {"_data": data, "_ts": time.time()}
        return data


def _cache_get_df(key: str, ttl: int = 60):
    """专门用于缓存 DataFrame 的函数"""
    entry = _cache.get(key)
    if entry is not None:
        ts = entry.get("_ts", 0) if isinstance(entry, dict) else 0
        if (time.time() - ts) < ttl:
            return entry.get("_data") if isinstance(entry, dict) else entry
    return None


def _cache_set_df(key: str, df):
    """缓存 DataFrame"""
    _cache[key] = {"_data": df, "_ts": time.time()}
    return df


# ==================== ETF 行情 ====================

def get_etf_history(code: str, days: int = 5) -> dict:
    """
    获取 ETF 历史 K 线数据 (东方财富)

    Returns:
        {latest_price, prev_close, change_pct, history: [{date, open, high, low, close, volume}]}
    """
    from datetime import datetime, timedelta

    try:
        end_date = datetime.now().strftime("%Y%m%d")
        start_date = (datetime.now() - timedelta(days=days + 10)).strftime("%Y%m%d")

        df = ak.fund_etf_hist_em(
            symbol=code, period="daily", start_date=start_date, end_date=end_date
        )

        if df is None or df.empty:
            return {"error": "No data returned"}

        recent = df.tail(days)
        history = []
        for _, row in recent.iterrows():
            history.append({
                "date": str(row.get("日期", "")),
                "open": float(row.get("开盘", 0)),
                "high": float(row.get("最高", 0)),
                "low": float(row.get("最低", 0)),
                "close": float(row.get("收盘", 0)),
                "volume": int(row.get("成交量", 0)),
            })

        latest = history[-1] if history else {}
        return {
            "latest_price": latest.get("close", 0),
            "prev_close": history[-2]["close"] if len(history) >= 2 else latest.get("close", 0),
            "history": history,
        }
    except Exception as e:
        logger.warning(f"get_etf_history({code}): {e}")
        return {"error": str(e)}


def get_etf_realtime_snapshot_akshare(code: str) -> dict:
    """
    通过 akshare 获取 ETF 实时快照 (东方财富 ETF 全列表接口)

    一次性获取全部 ETF 列表并缓存，后续个股查询直接从缓存读取
    使用锁防止并发请求时重复拉取全量数据
    """
    cache_key = f"ak_snapshot_{code}"
    cached = _cached(cache_key, ttl=10)
    if cached:
        return cached

    # 批量获取全部 ETF 列表 (全局缓存，60s TTL)
    # 加锁防止多个线程同时触发全量请求
    with _ak_etf_lock:
        df = _cache_get_df("ak_etf_all", ttl=60)
        if df is None:
            try:
                df = ak.fund_etf_spot_em()
                if df is not None and not df.empty:
                    _cache_set_df("ak_etf_all", df)
                else:
                    return {"error": f"No ETF data returned for {code}"}
            except Exception as e:
                logger.warning(f"fund_etf_spot_em() failed: {e}")
                return _get_etf_price_from_history(code)

    # 从缓存的 DataFrame 中查找对应代码
    try:
        match = df[df["代码"] == code]
        if not match.empty:
            row = match.iloc[0]
            result = {
                "price": float(row.get("最新价", 0)),
                "high": float(row.get("最高价", 0)) if "最高价" in df.columns else None,
                "low": float(row.get("最低价", 0)) if "最低价" in df.columns else None,
                "open": float(row.get("今开", 0)) if "今开" in df.columns else None,
                "volume": int(row.get("成交量", 0)) if "成交量" in df.columns else None,
                "turnover": float(row.get("成交额", 0)) if "成交额" in df.columns else None,
                "name": str(row.get("名称", "")),
                "prev_close": float(row.get("昨收", 0)) if "昨收" in df.columns else None,
                "change_pct": float(row.get("涨跌幅", 0)) if "涨跌幅" in df.columns else 0,
                "source": "akshare",
            }
            return _set_cache(cache_key, result)
    except Exception as e:
        logger.warning(f"ETF lookup for {code} failed: {e}")

    return _get_etf_price_from_history(code)


def _get_etf_price_from_history(code: str) -> dict:
    """通过历史K线获取最新价格 (慢速降级方案)"""
    hist = get_etf_history(code, days=2)
    if "error" not in hist and hist.get("latest_price"):
        return {
            "price": hist["latest_price"],
            "prev_close": hist.get("prev_close"),
            "name": code,
            "source": "akshare_history",
        }
    return {"error": f"No data for {code}"}


# ==================== 期权数据 ====================

def get_option_list_sse(underlying: str = "50ETF") -> dict:
    """
    获取上交所 ETF 期权合约到期月份列表

    Returns:
        {underlying, expiry_months: [...], contract_count: int}
    """
    try:
        expiry_list = ak.option_sse_list_sina(symbol=underlying)
        months = expiry_list if isinstance(expiry_list, list) else expiry_list.tolist()
        return {
            "underlying": underlying,
            "expiry_months": months,
            "contract_count": len(months),
        }
    except Exception as e:
        logger.warning(f"get_option_list_sse({underlying}): {e}")
        return {"error": str(e), "underlying": underlying, "expiry_months": []}


def get_option_current_day_sse(underlying: str = "") -> list[dict]:
    """
    获取当前交易日上交所期权合约实时行情

    Args:
        underlying: 标的名称，如 "50ETF", "300ETF"。为空时返回全部

    Returns:
        期权合约列表，含价格、成交量、隐含波动率等
    """
    try:
        df = ak.option_current_day_sse()

        if df is None or df.empty:
            return []

        contracts = []
        for _, row in df.head(200).iterrows():
            name = str(row.get("合约名称", ""))
            if underlying and underlying not in name:
                continue

            expiry_month = ""
            expiry_raw = row.get("到期日", "")
            if expiry_raw:
                expiry_str = str(expiry_raw)
                if len(expiry_str) >= 6:
                    expiry_month = expiry_str[:6]

            contracts.append({
                "code": str(row.get("合约交易代码", row.get("代码", ""))),
                "name": name,
                "strike": float(row.get("行权价", 0)) if row.get("行权价") else 0,
                "expiry": expiry_month,
                "expiry_month": expiry_month,
                "type": str(row.get("期权类型", "")),
                "latest_price": float(row.get("最新价", 0)) if "最新价" in df.columns else None,
                "volume": int(row.get("成交量", 0)) if "成交量" in df.columns else None,
                "open_interest": int(row.get("持仓量", 0)) if "持仓量" in df.columns else None,
                "change_pct": float(row.get("涨跌幅", 0)) if "涨跌幅" in df.columns else None,
            })
        return contracts
    except Exception as e:
        logger.warning(f"get_option_current_day_sse({underlying}): {e}")
        return [{"error": str(e)}]


def get_option_chain_with_prices(underlying_code: str, underlying_name: str) -> dict:
    """
    获取期权合约链（含到期月份 + 当前交易日的合约实时行情）

    Returns:
        {underlying_code, underlying_name, expiry_months, contracts, error}
    """
    result = {
        "underlying_code": underlying_code,
        "underlying_name": underlying_name,
        "expiry_months": [],
        "contracts": [],
        "error": None,
    }

    # 获取到期月份
    months_data = get_option_list_sse(underlying_name)
    if "error" not in months_data:
        result["expiry_months"] = months_data.get("expiry_months", [])

    # 获取当日合约行情
    contracts = get_option_current_day_sse()
    if contracts and "error" not in contracts[0] if contracts else True:
        result["contracts"] = contracts
    else:
        result["error"] = contracts[0].get("error") if contracts else "No contract data"

    return result


# ==================== 商品期货行情 ====================

# 期货合约中文名映射 (akshare futures_zh_realtime 使用中文品名)
FUTURES_SYMBOL_MAP = {
    "AU": "黄金",    # 黄金期货 → hj_qh
    "AG": "白银",    # 白银期货 → by_qh
    "CU": "沪铜",    # 铜期货   → tong_qh
    "M":  "豆粕",    # 豆粕期货 → dp_qh
    "RB": "螺纹钢",  # 螺纹钢期货 → lwg_qh
}

# 期货品种中文名
FUTURES_NAMES = {
    "AU": "黄金期货",
    "AG": "白银期货",
    "CU": "铜期货",
    "M":  "豆粕期货",
    "RB": "螺纹钢期货",
}


def get_futures_price(symbol: str) -> dict:
    """
    获取商品期货实时行情 (通过 akshare 新浪接口)

    Args:
        symbol: 品种代码，如 'AU', 'AG', 'CU', 'M', 'RB'

    Returns:
        {price, change_pct, volume, name, symbol, source}
    """
    cache_key = f"futures_{symbol}"
    cached = _cached(cache_key, ttl=5)
    if cached:
        return cached

    name = FUTURES_NAMES.get(symbol, f"{symbol}期货")
    cn_symbol = FUTURES_SYMBOL_MAP.get(symbol, symbol)

    try:
        df = ak.futures_zh_realtime(symbol=cn_symbol)
        if df is not None and not df.empty:
            # 取第一条 (通常是连续合约 AU0/AG0 等)
            row = df.iloc[0]
            result = {
                "symbol": symbol,
                "name": name,
                "price": float(row.get("trade", 0)),
                "change_pct": round(float(row.get("changepercent", 0)) * 100, 2),
                "volume": int(row.get("volume", 0)),
                "high": float(row.get("high", 0)),
                "low": float(row.get("low", 0)),
                "open": float(row.get("open", 0)),
                "prev_close": float(row.get("preclose", 0)),
                "prev_settlement": float(row.get("prevsettlement", 0)),
                "position": int(row.get("position", 0)),
                "contract_name": str(row.get("name", "")),
                "source": "akshare_futures",
            }
            return _set_cache(cache_key, result)
    except Exception as e:
        logger.warning(f"futures_zh_realtime({cn_symbol}) failed: {e}")

    return {"error": f"Futures data unavailable for {symbol}", "symbol": symbol, "name": name}


def get_futures_prices_batch(symbols: list[str]) -> dict[str, dict]:
    """
    批量获取多个商品期货实时行情

    Returns:
        {symbol: {price, change_pct, ...}}
    """
    results = {}
    for sym in symbols:
        results[sym] = get_futures_price(sym)
        time.sleep(0.1)  # 节流
    return results


# ==================== 港股指数行情 ====================

def get_hk_index_snapshot(index_code: str = "HSTECH") -> dict:
    """
    获取港股指数实时行情

    注意: 港股数据源需要从香港/中国大陆网络访问，
    海外环境可能不可用。数据不可用时返回 error。

    Args:
        index_code: 指数代码
            - 'HSTECH': 恒生科技指数
            - 'HSI': 恒生指数
            - 'HSCEI': 恒生中国企业指数 (H股指数)

    Returns:
        {price, change_pct, name, index_code} 或 {error, index_code}
    """
    cache_key = f"hk_index_{index_code}"
    cached = _cached(cache_key, ttl=60)  # 港股指数变动较慢，缓存60秒
    if cached:
        return cached

    # 指数名称映射
    index_names = {
        "HSTECH": "恒生科技指数",
        "HSI": "恒生指数",
        "HSCEI": "恒生中国企业指数",
    }
    name_cn = index_names.get(index_code, index_code)

    # 方案1: stock_hk_index_spot_em (东方财富港股指数行情)
    try:
        df = ak.stock_hk_index_spot_em()
        if df is not None and not df.empty:
            # 尝试多种匹配方式
            search_terms = [name_cn.replace("指数", ""), index_code, "恒生", "HSTECH", "HSI"]
            match = None
            for term in search_terms:
                if "名称" in df.columns:
                    m = df[df["名称"].str.contains(term, na=False)]
                elif "指数名称" in df.columns:
                    m = df[df["指数名称"].str.contains(term, na=False)]
                else:
                    break
                if not m.empty:
                    match = m
                    break

            if match is not None and not match.empty:
                row = match.iloc[0]
                result = {
                    "index_code": index_code,
                    "name": name_cn,
                    "price": float(row.get("最新价", row.get("当前点数", 0))),
                    "change_pct": float(row.get("涨跌幅", 0)) if "涨跌幅" in df.columns else 0,
                    "high": float(row.get("最高价", 0)) if "最高价" in df.columns else None,
                    "low": float(row.get("最低价", 0)) if "最低价" in df.columns else None,
                    "volume": float(row.get("成交量", 0)) if "成交量" in df.columns else None,
                    "source": "akshare_hk",
                }
                return _set_cache(cache_key, result)
    except Exception as e:
        logger.debug(f"stock_hk_index_spot_em failed: {e}")

    return {"error": f"HK index data unavailable for {index_code}", "index_code": index_code}


def get_hk_stock_price(code: str) -> dict:
    """
    获取港股个股实时行情 (可作为恒生科技成分股参考)

    Args:
        code: 港股代码，如 '00700' (腾讯), '09988' (阿里巴巴)
    """
    cache_key = f"hk_stock_{code}"
    cached = _cached(cache_key, ttl=15)
    if cached:
        return cached

    try:
        df = ak.stock_hk_spot_em()
        if df is not None and not df.empty:
            match = df[df["代码"] == code]
            if not match.empty:
                row = match.iloc[0]
                return _set_cache(cache_key, {
                    "code": code,
                    "name": str(row.get("名称", "")),
                    "price": float(row.get("最新价", 0)),
                    "change_pct": float(row.get("涨跌幅", 0)) if "涨跌幅" in df.columns else 0,
                })
    except Exception as e:
        logger.debug(f"stock_hk_spot_em({code}) failed: {e}")

    return {"error": f"HK stock data unavailable for {code}"}


# ==================== 数据源状态检查 ====================

def check_akshare_availability() -> dict:
    """
    检查 akshare 各数据源的可用性

    Returns:
        {source_name: {available: bool, latency_ms: float}}
    """
    results = {}

    # 测试 ETF 历史数据
    t0 = time.time()
    try:
        hist = get_etf_history("513100", days=1)
        results["etf_history"] = {
            "available": "error" not in hist,
            "latency_ms": round((time.time() - t0) * 1000),
        }
    except Exception:
        results["etf_history"] = {"available": False, "latency_ms": round((time.time() - t0) * 1000)}

    # 测试期货数据
    t0 = time.time()
    try:
        fut = get_futures_price("AU")
        results["futures"] = {
            "available": "error" not in fut,
            "latency_ms": round((time.time() - t0) * 1000),
        }
    except Exception:
        results["futures"] = {"available": False, "latency_ms": round((time.time() - t0) * 1000)}

    # 测试港股指数
    t0 = time.time()
    try:
        hk = get_hk_index_snapshot("HSTECH")
        results["hk_index"] = {
            "available": "error" not in hk,
            "latency_ms": round((time.time() - t0) * 1000),
        }
    except Exception:
        results["hk_index"] = {"available": False, "latency_ms": round((time.time() - t0) * 1000)}

    # 测试期权数据
    t0 = time.time()
    try:
        opt = get_option_list_sse("50ETF")
        results["option_sse"] = {
            "available": "error" not in opt,
            "latency_ms": round((time.time() - t0) * 1000),
        }
    except Exception:
        results["option_sse"] = {"available": False, "latency_ms": round((time.time() - t0) * 1000)}

    return results
