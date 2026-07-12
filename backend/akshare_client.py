"""
Akshare 数据客户端
用于获取历史数据和期权链等结构化数据
"""

import akshare as ak
from typing import Optional


def get_etf_history(code: str, days: int = 5) -> dict:
    """
    获取 ETF 历史 K 线数据

    Args:
        code: ETF 代码
        days: 获取最近几天数据

    Returns:
        {latest_price, prev_close, change_pct, history: [{date, open, high, low, close, volume}]}
    """
    try:
        from datetime import datetime, timedelta

        end_date = datetime.now().strftime("%Y%m%d")
        start_date = (datetime.now() - timedelta(days=days + 10)).strftime("%Y%m%d")

        df = ak.fund_etf_hist_em(
            symbol=code, period="daily", start_date=start_date, end_date=end_date
        )

        if df is None or df.empty:
            return {"error": "No data returned"}

        # 取最近 N 行
        recent = df.tail(days)
        history = []
        for _, row in recent.iterrows():
            history.append(
                {
                    "date": str(row.get("日期", "")),
                    "open": float(row.get("开盘", 0)),
                    "high": float(row.get("最高", 0)),
                    "low": float(row.get("最低", 0)),
                    "close": float(row.get("收盘", 0)),
                    "volume": int(row.get("成交量", 0)),
                }
            )

        latest = history[-1] if history else {}
        return {
            "latest_price": latest.get("close", 0),
            "prev_close": history[-2]["close"] if len(history) >= 2 else latest.get("close", 0),
            "history": history,
        }
    except Exception as e:
        return {"error": str(e)}


def get_option_list_sse(underlying: str = "50ETF") -> dict:
    """
    获取上交所 ETF 期权合约列表

    Args:
        underlying: 标的名称，如 '50ETF', '300ETF', '500ETF', '科创50'

    Returns:
        {expiry_months: [...], contract_count: int}
    """
    try:
        expiry_list = ak.option_sse_list_sina(symbol=underlying)
        return {
            "underlying": underlying,
            "expiry_months": expiry_list if isinstance(expiry_list, list) else expiry_list.tolist(),
        }
    except Exception as e:
        return {"error": str(e), "underlying": underlying}


def get_option_current_day_sse() -> list[dict]:
    """
    获取当前交易日上交所所有期权合约数据

    Returns:
        期权合约列表
    """
    try:
        df = ak.option_current_day_sse()

        if df is None or df.empty:
            return []

        contracts = []
        for _, row in df.head(100).iterrows():  # 限制返回数量
            contracts.append(
                {
                    "code": str(row.get("合约交易代码", row.get("代码", ""))),
                    "name": str(row.get("合约名称", "")),
                    "strike": float(row.get("行权价", 0)) if row.get("行权价") else 0,
                    "expiry": str(row.get("到期日", "")),
                    "type": str(row.get("期权类型", "")),
                }
            )
        return contracts
    except Exception as e:
        return [{"error": str(e)}]


def get_futures_price(symbol: str) -> dict:
    """
    获取商品期货价格 (简化版)

    尝试通过 akshare 获取，失败则返回预设值
    """
    try:
        df = ak.futures_zh_realtime(symbol=symbol)
        if df is not None and not df.empty:
            row = df.iloc[0]
            return {
                "price": float(row.get("最新价", 0)),
                "change_pct": float(row.get("涨跌幅", 0)) if "涨跌幅" in df.columns else 0,
                "volume": int(row.get("成交量", 0)) if "成交量" in df.columns else 0,
            }
    except Exception:
        pass
    return {"error": "Futures data unavailable"}
