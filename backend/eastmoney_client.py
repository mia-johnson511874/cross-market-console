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
_cache_ttl = 15  # 缓存15秒（与前端10秒轮询对齐）


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


# ==================== 期权实时行情 (东财, 不依赖 akshare) ====================
# 数据源: 东方财富-行情中心-期权市场 https://quote.eastmoney.com/center/qqsc.html
# fs=m:10(上交所期权) m:12(深交所期权)
# 字段: f12代码 f13市场 f14名称 f2最新价 f3涨跌幅 f5成交量 f6成交额
#       f17今开 f18昨结 f108持仓量 f161行权价 f162剩余日

OPTION_CLIST_PATH = "/api/qt/clist/get"
OPTION_CLIST_HOSTS = [
    "https://push2.eastmoney.com",
    "http://push2.eastmoney.com",
    "https://push2delay.eastmoney.com",  # 延时行情节点, 主节点被限流/拦截时兜底
    "http://push2delay.eastmoney.com",
]
OPTION_FS = "m:10,m:12"
OPTION_FIELDS = "f12,f13,f14,f2,f3,f5,f6,f17,f18,f108,f161,f162"
_OPTION_UT = "bd1d9ddb04089700cf9c27f6f7426281"
_option_cache: dict[str, dict] = {}
_OPTION_CACHE_TTL = 60  # 期权链缓存60秒

_OPTION_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://quote.eastmoney.com/center/qqsc.html",
}


def _option_url(host: str, page: int, page_size: int) -> str:
    return (
        f"{host}{OPTION_CLIST_PATH}?pn={page}&pz={page_size}&po=1&np=1"
        f"&ut={_OPTION_UT}&fltt=2&invt=2&fid=f3"
        f"&fs={OPTION_FS}&fields={OPTION_FIELDS}"
    )


def _fetch_option_page_via_urllib(page: int, page_size: int) -> Optional[dict]:
    """urllib 直连 (绕过系统代理), https 失败自动降级 http"""
    for host in OPTION_CLIST_HOSTS:
        try:
            ssl_ctx = ssl.create_default_context()
            opener = urllib.request.build_opener(
                urllib.request.ProxyHandler({}),
                urllib.request.HTTPSHandler(context=ssl_ctx),
            )
            req = urllib.request.Request(
                _option_url(host, page, page_size), headers=_OPTION_HEADERS
            )
            resp = opener.open(req, timeout=3)
            data = json.loads(resp.read())
            if data.get("rc") == 0 and data.get("data"):
                return data
        except Exception:
            continue
    return None


def _fetch_option_page_via_requests(page: int, page_size: int) -> Optional[dict]:
    """requests 通道, 显式禁用代理"""
    for host in OPTION_CLIST_HOSTS:
        try:
            resp = requests.get(
                _option_url(host, page, page_size),
                headers=_OPTION_HEADERS,
                timeout=3,
                proxies={"http": None, "https": None},
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("rc") == 0 and data.get("data"):
                return data
        except Exception:
            continue
    return None


def _fetch_option_page(page: int, page_size: int) -> Optional[dict]:
    """双通道获取一页期权行情"""
    data = _fetch_option_page_via_urllib(page, page_size)
    if data:
        return data
    return _fetch_option_page_via_requests(page, page_size)


def _num(val):
    """东财延时节点无成交的合约返回 "-", 统一转为 None"""
    if val is None or val == "-" or val == "":
        return None
    return val


def _parse_option_name(name: str) -> Optional[dict]:
    """
    解析合约名称, 如 "50ETF购8月2900" / "科创50沽12月1550" / "300ETF购1月4000A"
    返回 {type, month, type_label}
    """
    import re

    m = re.match(r"^.+?(购|沽)(\d{1,2})月(\d+)(A?)$", name)
    if not m:
        return None
    return {
        "type_label": "认购" if m.group(1) == "购" else "认沽",
        "month": int(m.group(2)),
    }


def _expiry_yyyymm(month: int, days_left: Optional[float]) -> str:
    """由合约月份推算 YYYYMM (期权仅挂牌近几个月, 小于当前月即为明年)"""
    now = time.localtime()
    year = now.tm_year
    if month < now.tm_mon:
        year += 1
    elif month == now.tm_mon and days_left is not None and days_left <= 0:
        year += 1
    return f"{year}{month:02d}"


def get_option_chain_em(underlying_keyword: str, market: str = "") -> dict:
    """
    东方财富 期权实时行情链 (akshare 的替代数据源)

    Args:
        underlying_keyword: 合约名称前缀, 如 "50ETF", "300ETF", "500ETF", "科创50"
        market: ""=全部, "10"=仅上交所, "12"=仅深交所

    Returns:
        {
          "expiry_months": ["202508", ...],
          "contracts": [{code, name, strike, expiry, type, latest_price,
                         volume, open_interest, change_pct, days_left}],
          "source": "eastmoney",
          "error": None | str,
        }
    """
    cache_key = f"optchain_{underlying_keyword}_{market}"
    now = time.time()
    cached = _option_cache.get(cache_key)
    if cached and (now - cached.get("_ts", 0)) < _OPTION_CACHE_TTL:
        return {k: v for k, v in cached.items() if k != "_ts"}

    result = {"expiry_months": [], "contracts": [], "source": "eastmoney", "error": None}

    page_size = 100  # 东财单页实际上限100条, 更大会被截断导致误判翻页结束
    page = 1
    total = None
    items: list[dict] = []
    while page <= 20:
        data = None
        for attempt in range(3):  # 每页最多重试3次, 容忍单页偶发断连
            data = _fetch_option_page(page, page_size)
            if data:
                break
            time.sleep(0.5)
        if not data:
            break
        d = data.get("data") or {}
        if total is None:
            total = d.get("total", 0)
        diff = d.get("diff") or []
        items.extend(diff)
        if not diff or len(items) >= (total or 0):
            break
        page += 1

    if not items:
        result["error"] = "eastmoney option chain unavailable"
        return result

    for it in items:
        name = str(it.get("f14", ""))
        if not name.startswith(underlying_keyword):
            continue
        f13 = str(it.get("f13", ""))
        if market and f13 != market:
            continue

        parsed = _parse_option_name(name)
        if not parsed:
            continue
        strike = _num(it.get("f161"))
        if strike is None:
            continue
        days_left = it.get("f162")
        expiry = _expiry_yyyymm(parsed["month"], days_left)

        result["contracts"].append({
            "code": str(it.get("f12", "")),
            "name": name,
            "strike": _num(it.get("f161")),
            "expiry": expiry,
            "type": parsed["type_label"],
            "latest_price": _num(it.get("f2")),
            "volume": _num(it.get("f5")),
            "open_interest": _num(it.get("f108")),
            "change_pct": _num(it.get("f3")),
            "days_left": _num(it.get("f162")),
        })

    if result["contracts"]:
        result["expiry_months"] = sorted({c["expiry"] for c in result["contracts"]})
    else:
        result["error"] = f"no contracts matched {underlying_keyword}"

    result["_ts"] = now
    _option_cache[cache_key] = result
    return {k: v for k, v in result.items() if k != "_ts"}
