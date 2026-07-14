import time
import logging
import os
import requests
from typing import Optional

logger = logging.getLogger(__name__)

_cache: dict[str, dict] = {}
_cache_ttl = 60

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

PROXIES = {
    "http": os.environ.get("http_proxy"),
    "https": os.environ.get("https_proxy"),
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


def _fetch_yahoo_finance(symbol: str, market: str = "") -> dict:
    yahoo_symbol = symbol
    if market == "1" and symbol.isdigit():
        yahoo_symbol = f"{symbol}.SS"
    elif market == "0" and symbol.isdigit():
        yahoo_symbol = f"{symbol}.SZ"
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_symbol}?region=US&lang=en-US&includePrePost=false&interval=1m&range=1d&corsDomain=finance.yahoo.com&formatted=false"
    try:
        time.sleep(0.3)
        resp = requests.get(url, headers=HEADERS, timeout=10, proxies=PROXIES)
        resp.raise_for_status()
        data = resp.json()
        result = data.get("chart", {}).get("result", [])
        if not result:
            return {"error": "No data returned"}

        meta = result[0].get("meta", {})
        price = meta.get("regularMarketPrice")
        if price is None:
            return {"error": "No price data"}

        high = meta.get("regularMarketDayHigh", price)
        low = meta.get("regularMarketDayLow", price)
        volume = meta.get("regularMarketVolume", 0)
        prev_close = meta.get("previousClose", price)
        name = meta.get("longName", meta.get("shortName", symbol))
        change_pct = ((price - prev_close) / prev_close) * 100 if prev_close else 0

        return {
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
    except requests.RequestException as e:
        logger.warning(f"Yahoo Finance request failed for {symbol}: {e}")
        return {"error": str(e)}
    except Exception as e:
        logger.warning(f"Yahoo Finance parse failed for {symbol}: {e}")
        return {"error": str(e)}


def get_etf_snapshot_yfinance(code: str, market: str = "") -> dict:
    cache_key = f"yf_{code}_{market}"
    cached = _cached(cache_key)
    if cached:
        return cached

    result = _fetch_yahoo_finance(code, market)
    if "error" not in result:
        return _set_cache(cache_key, result)
    return result


def get_etf_snapshots_batch_yfinance(codes: list[str], markets: list[str] = None) -> dict[str, dict]:
    results: dict[str, dict] = {}
    for i, code in enumerate(codes):
        market = markets[i] if markets else ""
        result = get_etf_snapshot_yfinance(code, market)
        results[code] = result
    return results


def check_yfinance_availability() -> dict:
    t0 = time.time()
    try:
        result = get_etf_snapshot_yfinance("QQQ")
        return {
            "available": "error" not in result,
            "latency_ms": round((time.time() - t0) * 1000),
        }
    except Exception as e:
        logger.warning(f"Yahoo Finance check failed: {e}")
        return {"available": False, "latency_ms": round((time.time() - t0) * 1000)}
