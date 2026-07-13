import yfinance as yf
import time
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_cache: dict[str, dict] = {}
_cache_ttl = 30

ETF_SYMBOL_MAP: dict[str, str] = {
    "513130": "513130.SS",
    "513220": "513220.SS",
    "513050": "513050.SS",
    "159920": "159920.SZ",
    "510900": "510900.SS",
    "513120": "513120.SS",
    "513190": "513190.SS",
    "513600": "513600.SS",
    "513100": "513100.SS",
    "513500": "513500.SS",
    "159941": "159941.SZ",
    "159659": "159659.SZ",
    "159632": "159632.SZ",
    "159866": "159866.SZ",
    "513030": "513030.SS",
    "518880": "518880.SS",
    "159937": "159937.SZ",
    "159985": "159985.SZ",
    "161226": "161226.SZ",
    "159980": "159980.SZ",
}


def _cached(key: str):
    entry = _cache.get(key)
    if entry and (time.time() - entry.get("_ts", 0)) < _cache_ttl:
        return {k: v for k, v in entry.items() if k != "_ts"}
    return None


def _set_cache(key: str, data: dict):
    data["_ts"] = time.time()
    _cache[key] = data
    return {k: v for k, v in data.items() if k != "_ts"}


def get_etf_snapshot_yfinance(code: str) -> dict:
    """
    通过 Yahoo Finance 获取 ETF 实时快照
    支持海外环境访问
    """
    cache_key = f"yf_{code}"
    cached = _cached(cache_key)
    if cached:
        return cached

    symbol = ETF_SYMBOL_MAP.get(code, code)

    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info

        if not info or "currentPrice" not in info:
            hist = ticker.history(period="1d")
            if hist.empty:
                return {"error": f"No data for {code} ({symbol})"}

            price = hist["Close"].iloc[-1]
            prev_close = hist["Open"].iloc[0] if len(hist) > 0 else price
            high = hist["High"].iloc[-1] if len(hist) > 0 else price
            low = hist["Low"].iloc[-1] if len(hist) > 0 else price
            volume = hist["Volume"].iloc[-1] if len(hist) > 0 else 0

            change_pct = ((price - prev_close) / prev_close) * 100 if prev_close else 0

            result = {
                "price": round(float(price), 3),
                "high": round(float(high), 3),
                "low": round(float(low), 3),
                "open": round(float(prev_close), 3),
                "volume": int(volume),
                "name": info.get("shortName", code),
                "prev_close": round(float(prev_close), 3),
                "change_pct": round(change_pct, 2),
                "source": "yfinance",
            }
            return _set_cache(cache_key, result)

        price = info["currentPrice"]
        prev_close = info.get("previousClose", price)
        high = info.get("dayHigh", price)
        low = info.get("dayLow", price)
        open_price = info.get("open", price)
        volume = info.get("volume", 0)
        change_pct = info.get("regularMarketChangePercent", 0)

        result = {
            "price": round(float(price), 3),
            "high": round(float(high), 3) if high else None,
            "low": round(float(low), 3) if low else None,
            "open": round(float(open_price), 3) if open_price else None,
            "volume": int(volume) if volume else None,
            "name": info.get("shortName", info.get("longName", code)),
            "prev_close": round(float(prev_close), 3) if prev_close else None,
            "change_pct": round(float(change_pct), 2),
            "source": "yfinance",
        }
        return _set_cache(cache_key, result)

    except Exception as e:
        logger.warning(f"yfinance fetch failed for {code}: {e}")
        return {"error": str(e)}


def check_yfinance_availability() -> dict:
    """检查 Yahoo Finance 数据源可用性"""
    t0 = time.time()
    try:
        result = get_etf_snapshot_yfinance("513100")
        return {
            "available": "error" not in result,
            "latency_ms": round((time.time() - t0) * 1000),
        }
    except Exception as e:
        logger.warning(f"yfinance check failed: {e}")
        return {"available": False, "latency_ms": round((time.time() - t0) * 1000)}