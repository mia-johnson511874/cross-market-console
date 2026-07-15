import time
import logging
import os
import requests
from typing import Optional, Dict, List
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger(__name__)

_cache: dict[str, dict] = {}
_cache_ttl = 30  # 缓存30秒（限流保护，比前端轮询慢3倍）

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://finance.yahoo.com/",
}

_proxy_http = os.environ.get("http_proxy") or os.environ.get("HTTP_PROXY") or "http://proxy.server:3128"
_proxy_https = os.environ.get("https_proxy") or os.environ.get("HTTPS_PROXY") or "http://proxy.server:3128"

PROXIES = {
    "http": _proxy_http,
    "https": _proxy_https,
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
    
    max_retries = 3
    base_delay = 1.0
    
    for attempt in range(max_retries):
        try:
            time.sleep(base_delay + attempt * 0.5)
            resp = requests.get(url, headers=HEADERS, timeout=15, proxies=PROXIES)
            
            if resp.status_code == 429:
                if attempt < max_retries - 1:
                    logger.warning(f"Yahoo Finance rate limited for {symbol}, retrying in {base_delay * (attempt + 1)}s")
                    time.sleep(base_delay * (attempt + 1))
                    continue
                else:
                    return {"error": "Rate limited"}
            
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
            logger.warning(f"Yahoo Finance request failed for {symbol} (attempt {attempt+1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                time.sleep(base_delay * (attempt + 1))
                continue
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


def get_batch_quotes_spark(symbols: List[str]) -> Dict[str, dict]:
    """
    使用 Yahoo Finance spark 批量接口一次性获取多个品种的实时报价
    spark 接口支持单次请求多个 symbol，返回字段较少但速度极快
    
    参数:
        symbols: Yahoo Finance 代码列表，如 ["QQQ", "SPY", "GLD"]
    
    返回:
        {symbol: {price, prev_close, change_pct, ...}}
    """
    if not symbols:
        return {}

    results: Dict[str, dict] = {}
    need_fetch: List[str] = []
    
    for symbol in symbols:
        cached = _cached(f"spark_{symbol}")
        if cached:
            results[symbol] = cached
        else:
            need_fetch.append(symbol)
    
    if not need_fetch:
        return results
    
    symbols_str = ",".join(need_fetch)
    url = f"https://query1.finance.yahoo.com/v8/finance/spark?symbols={symbols_str}&range=1d&interval=1m&includePrePost=false&corsDomain=finance.yahoo.com"

    try:
        resp = requests.get(url, headers=HEADERS, timeout=10, proxies=PROXIES)
        
        if resp.status_code == 429:
            logger.warning("Yahoo Finance spark batch rate limited")
            return results
        
        resp.raise_for_status()
        data = resp.json()
        
        fetched_count = 0
        for symbol in need_fetch:
            item = data.get(symbol, {})
            if not item or not isinstance(item.get("response"), list) or len(item["response"]) == 0:
                continue
            
            quote = item["response"][0].get("quote", {})
            price = quote.get("regularMarketPrice")
            prev_close = quote.get("previousClose")
            
            if price is None:
                continue
            
            change_pct = ((price - prev_close) / prev_close) * 100 if prev_close else 0
            
            snap = {
                "price": round(float(price), 3),
                "prev_close": round(float(prev_close), 3) if prev_close else round(float(price), 3),
                "change_pct": round(change_pct, 2),
                "source": "yfinance_spark",
            }
            
            _set_cache(f"spark_{symbol}", snap)
            results[symbol] = snap
            fetched_count += 1
        
        logger.info(f"Yahoo Finance spark batch: fetched {fetched_count}/{len(need_fetch)} symbols (cached: {len(symbols) - len(need_fetch)})")
        return results
    
    except requests.RequestException as e:
        logger.warning(f"Yahoo Finance spark batch request failed: {e}")
        return results
    except Exception as e:
        logger.warning(f"Yahoo Finance spark batch parse failed: {e}")
        return results


def get_etf_snapshots_concurrent(symbols: List[str], markets: Optional[List[str]] = None, max_workers: int = 5) -> Dict[str, dict]:
    """
    使用并发方式获取多个 ETF 快照（fallback 方案）
    
    参数:
        symbols: Yahoo Finance 代码列表
        markets: 市场列表，与 symbols 一一对应
        max_workers: 最大并发数，建议不超过5以避免限流
    
    返回:
        {symbol: {price, prev_close, change_pct, ...}}
    """
    if not symbols:
        return {}

    results: Dict[str, dict] = {}
    markets = markets or [""] * len(symbols)
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_symbol = {
            executor.submit(get_etf_snapshot_yfinance, symbols[i], markets[i]): symbols[i]
            for i in range(len(symbols))
        }
        
        for future in as_completed(future_to_symbol):
            symbol = future_to_symbol[future]
            try:
                result = future.result()
                results[symbol] = result
            except Exception as e:
                logger.warning(f"Concurrent fetch failed for {symbol}: {e}")
                results[symbol] = {"error": str(e)}
    
    logger.info(f"Yahoo Finance concurrent: fetched {len([r for r in results.values() if 'error' not in r])}/{len(symbols)} symbols")
    return results
