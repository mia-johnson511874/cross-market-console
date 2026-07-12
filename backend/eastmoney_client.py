"""
东方财富 API 客户端
双通道：urllib (绕过代理) + requests (备用)
"""

import json
import ssl
import time
import urllib.request
from typing import Optional

import requests

BASE_URL = "https://push2.eastmoney.com/api/qt/stock/get"

# 缓存最近的成功请求结果，避免重复请求
_cache: dict[str, dict] = {}
_cache_ttl = 30  # 缓存30秒


def _fetch_via_urllib(secid: str, fields: str) -> Optional[dict]:
    """通过 urllib + ProxyHandler({}) 绕过系统代理"""
    try:
        ctx = ssl.create_default_context()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        url = f"{BASE_URL}?secid={secid}&fields={fields}"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                "Referer": "https://quote.eastmoney.com/",
            },
        )
        resp = opener.open(req, timeout=4)
        return json.loads(resp.read())
    except Exception:
        return None


def _fetch_via_requests(secid: str, fields: str) -> Optional[dict]:
    """通过 requests + trust_env=False 获取"""
    try:
        resp = requests.get(
            BASE_URL,
            params={"secid": secid, "fields": fields},
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                "Referer": "https://quote.eastmoney.com/",
            },
            timeout=4,
            proxies={"http": None, "https": None},  # 显式禁用代理
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return None


def _fetch_with_retry(secid: str, fields: str, max_retries: int = 2) -> Optional[dict]:
    """带重试的双通道获取 (短超时，快速失败)"""
    for attempt in range(max_retries):
        result = _fetch_via_urllib(secid, fields)
        if result and result.get("rc") == 0 and result.get("data"):
            return result

        result = _fetch_via_requests(secid, fields)
        if result and result.get("rc") == 0 and result.get("data"):
            return result

        if attempt < max_retries - 1:
            time.sleep(0.3)

    return None


def _parse_snapshot(data: dict) -> dict:
    """解析东方财富 API 返回的快照数据"""
    d = data["data"]
    raw_price = d.get("f43", 0)
    # 价格处理：ETF 通常 <100，但东方财富返回的是实际价格*1000 或原值
    if raw_price > 100:
        divisor = 1000
    else:
        divisor = 1

    def _div(val):
        if val is None:
            return None
        return val / divisor

    return {
        "price": raw_price / divisor,
        "high": _div(d.get("f44")),
        "low": _div(d.get("f45")),
        "open": _div(d.get("f46")),
        "volume": d.get("f47"),
        "turnover": d.get("f48"),
        "name": d.get("f58", ""),
        "prev_close": _div(d.get("f60")),
        "change_pct": d.get("f170", 0) / 100 if d.get("f170") else 0,
        "pe": d.get("f169"),
    }


def get_etf_snapshot(code: str, market: str = "1") -> dict:
    """
    获取单个 ETF 实时快照
    优先使用缓存
    """
    secid = f"{market}.{code}"
    cache_key = f"snapshot_{secid}"

    now = time.time()
    cached = _cache.get(cache_key)
    if cached and (now - cached.get("_ts", 0)) < _cache_ttl:
        # 返回缓存副本，去掉时间戳
        result = {k: v for k, v in cached.items() if k != "_ts"}
        return result

    fields = "f43,f44,f45,f46,f47,f48,f57,f58,f60,f169,f170,f171"
    result = _fetch_with_retry(secid, fields)

    if result is None:
        return {"error": "Network error: unable to fetch data after retries"}

    parsed = _parse_snapshot(result)
    parsed["_ts"] = now
    _cache[cache_key] = parsed

    return {k: v for k, v in parsed.items() if k != "_ts"}


def get_etf_snapshots_batch(codes: list[dict]) -> list[dict]:
    """批量获取 ETF 快照"""
    results = []
    for item in codes:
        result = get_etf_snapshot(item["code"], item.get("market", "1"))
        result["code"] = item["code"]
        results.append(result)
        time.sleep(0.15)  # 节流
    return results


def get_index_snapshot(code: str, market: str = "1") -> dict:
    """获取指数快照"""
    secid = f"{market}.{code}"
    fields = "f43,f44,f45,f46,f57,f58,f60,f170"
    result = _fetch_with_retry(secid, fields)

    if result is None:
        return {"error": "Unable to fetch index data"}

    d = result["data"]
    return {
        "price": d.get("f43", 0),
        "high": d.get("f44", 0),
        "low": d.get("f45", 0),
        "open": d.get("f46", 0),
        "name": d.get("f58", ""),
        "prev_close": d.get("f60", 0),
        "change_pct": d.get("f170", 0) / 100 if d.get("f170") else 0,
    }
