import time
import logging
import requests
import pandas as pd
from typing import Optional

logger = logging.getLogger(__name__)

_yf = None
try:
    import yfinance as yf
    _yf = yf
    logger.info("yfinance module loaded successfully")
except ImportError:
    logger.warning("yfinance not installed — Yahoo Finance data source unavailable")

_cache: dict[str, dict] = {}
_cache_ttl = 60

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
    if _yf is None:
        return {"error": "yfinance not installed"}

    cache_key = f"yf_{code}"
    cached = _cached(cache_key)
    if cached:
        return cached

    symbol = ETF_SYMBOL_MAP.get(code, code)

    try:
        time.sleep(0.5)

        ticker = _yf.Ticker(symbol)
        hist = ticker.history(period="1d", interval="1m")

        if hist.empty:
            hist = ticker.history(period="1d")
            if hist.empty:
                return {"error": f"No data for {code} ({symbol})"}

        price = hist["Close"].iloc[-1]
        prev_close = hist["Open"].iloc[0] if len(hist) > 0 else price
        high = hist["High"].iloc[-1] if len(hist) > 0 else price
        low = hist["Low"].iloc[-1] if len(hist) > 0 else price
        volume = hist["Volume"].iloc[-1] if len(hist) > 0 else 0

        change_pct = ((price - prev_close) / prev_close) * 100 if prev_close else 0

        info = ticker.info
        name = info.get("shortName", info.get("longName", code)) if info else code

        result = {
            "price": round(float(price), 3),
            "high": round(float(high), 3),
            "low": round(float(low), 3),
            "open": round(float(prev_close), 3),
            "volume": int(volume),
            "name": name,
            "prev_close": round(float(prev_close), 3),
            "change_pct": round(change_pct, 2),
            "source": "yfinance",
        }
        return _set_cache(cache_key, result)

    except Exception as e:
        logger.warning(f"yfinance fetch failed for {code}: {e}")
        return {"error": str(e)}


def get_etf_snapshots_batch_yfinance(codes: list[str]) -> dict[str, dict]:
    if _yf is None:
        return {code: {"error": "yfinance not installed"} for code in codes}

    symbols = [ETF_SYMBOL_MAP.get(c, c) for c in codes]
    try:
        time.sleep(1)

        data = _yf.download(symbols, period="1d", interval="1m", progress=False)

        results: dict[str, dict] = {}
        if isinstance(data.columns, pd.MultiIndex):
            for code, symbol in zip(codes, symbols):
                if symbol in data.columns.get_level_values(0):
                    hist = data[symbol]
                    if not hist.empty:
                        price = hist["Close"].iloc[-1]
                        prev_close = hist["Open"].iloc[0]
                        high = hist["High"].iloc[-1]
                        low = hist["Low"].iloc[-1]
                        volume = hist["Volume"].iloc[-1]
                        change_pct = ((price - prev_close) / prev_close) * 100 if prev_close else 0

                        results[code] = {
                            "price": round(float(price), 3),
                            "high": round(float(high), 3),
                            "low": round(float(low), 3),
                            "open": round(float(prev_close), 3),
                            "volume": int(volume),
                            "prev_close": round(float(prev_close), 3),
                            "change_pct": round(change_pct, 2),
                            "source": "yfinance",
                        }
                        _set_cache(f"yf_{code}", results[code])
                    else:
                        results[code] = {"error": f"No data for {code}"}
                else:
                    results[code] = {"error": f"No data for {code}"}
        else:
            hist = data
            if not hist.empty:
                price = hist["Close"].iloc[-1]
                prev_close = hist["Open"].iloc[0]
                high = hist["High"].iloc[-1]
                low = hist["Low"].iloc[-1]
                volume = hist["Volume"].iloc[-1]
                change_pct = ((price - prev_close) / prev_close) * 100 if prev_close else 0

                results[codes[0]] = {
                    "price": round(float(price), 3),
                    "high": round(float(high), 3),
                    "low": round(float(low), 3),
                    "open": round(float(prev_close), 3),
                    "volume": int(volume),
                    "prev_close": round(float(prev_close), 3),
                    "change_pct": round(change_pct, 2),
                    "source": "yfinance",
                }
                _set_cache(f"yf_{codes[0]}", results[codes[0]])

        return results

    except Exception as e:
        logger.warning(f"yfinance batch fetch failed: {e}")
        return {code: {"error": str(e)} for code in codes}


def check_yfinance_availability() -> dict:
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