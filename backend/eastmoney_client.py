"""
东方财富 API 客户端
双通道：urllib (绕过代理) + requests (备用)
"""

import json
import ssl
import time
import urllib.request
from typing import Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

BASE_URL = "https://push2.eastmoney.com/api/qt/stock/get"
BATCH_URL = "https://push2.eastmoney.com/api/qt/ulist.np/get"

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
        resp = opener.open(req, timeout=2)
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
            timeout=2,
            proxies={"http": None, "https": None},  # 显式禁用代理
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return None


def _fetch_with_retry(secid: str, fields: str, max_retries: int = 1) -> Optional[dict]:
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


def _fetch_batch_via_urllib(secids: str, fields: str) -> Optional[dict]:
    """通过 urllib 获取东方财富批量行情"""
    try:
        ctx = ssl.create_default_context()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        url = f"{BATCH_URL}?fltt=2&invt=2&fields={fields}&secids={secids}"
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
        resp = opener.open(req, timeout=3)
        return json.loads(resp.read())
    except Exception:
        return None


def _fetch_batch_via_requests(secids: str, fields: str) -> Optional[dict]:
    """通过 requests 获取东方财富批量行情"""
    try:
        resp = requests.get(
            BATCH_URL,
            params={"fltt": "2", "invt": "2", "fields": fields, "secids": secids},
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                "Referer": "https://quote.eastmoney.com/",
            },
            timeout=3,
            proxies={"http": None, "https": None},
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return None


def _fetch_batch_with_retry(secids: str, fields: str, max_retries: int = 1) -> Optional[dict]:
    """带重试的批量行情获取"""
    for attempt in range(max_retries):
        result = _fetch_batch_via_urllib(secids, fields)
        if result and result.get("rc") == 0 and result.get("data"):
            return result

        result = _fetch_batch_via_requests(secids, fields)
        if result and result.get("rc") == 0 and result.get("data"):
            return result

        if attempt < max_retries - 1:
            time.sleep(0.3)
    return None


def _parse_batch_snapshot(item: dict) -> dict:
    """解析 ulist.np 批量接口返回的单条数据"""
    return {
        "price": item.get("f2"),
        "high": item.get("f15"),
        "low": item.get("f16"),
        "open": item.get("f17"),
        "volume": item.get("f5"),
        "turnover": item.get("f6"),
        "name": item.get("f14", ""),
        "prev_close": item.get("f18"),
        "change_pct": item.get("f3", 0),
        "code": item.get("f12"),
        "market": str(item.get("f13", "1")),
    }


def get_etf_snapshots_batch_eastmoney(codes: list[dict]) -> list[dict]:
    """
    通过东方财富批量接口一次获取多只 ETF 快照。
    比单只轮询快一个数量级。
    """
    if not codes:
        return []

    secids = ",".join(f"{item.get('market', '1')}.{item['code']}" for item in codes)
    fields = "f12,f13,f14,f2,f3,f4,f5,f6,f15,f16,f17,f18"
    result = _fetch_batch_with_retry(secids, fields)

    if result is None:
        return [{"code": item["code"], "error": "Network error"} for item in codes]

    diff = result.get("data", {}).get("diff", [])
    parsed = {item.get("f12"): _parse_batch_snapshot(item) for item in diff if item.get("f12")}

    results = []
    for item in codes:
        code = item["code"]
        if code in parsed:
            snap = parsed[code]
            snap["source"] = "eastmoney"
            results.append(snap)
        else:
            results.append({"code": code, "error": f"Code {code} not found in batch response"})
    return results


def get_etf_snapshots_batch(codes: list[dict], max_workers: int = 8) -> list[dict]:
    """批量获取 ETF 快照（并发单只接口，备用）"""
    results = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_code = {
            executor.submit(get_etf_snapshot, item["code"], item.get("market", "1")): item
            for item in codes
        }
        for future in as_completed(future_to_code):
            item = future_to_code[future]
            try:
                result = future.result()
            except Exception:
                result = {"error": f"Failed to fetch {item['code']}"}
            result["code"] = item["code"]
            results.append(result)
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
