# A股ETF → 美股ETF 映射表

## 概述

由于海外服务器（PythonAnywhere）无法访问东方财富等国内数据源，本项目将 A 股 ETF 代码映射到功能类似的美股 ETF，通过 Yahoo Finance API 获取真实实时行情数据。

## 映射关系

| A股代码 | A股名称 | 映射美股 | 美股名称 | 类型 |
|---------|---------|---------|---------|------|
| 513100 | 纳指ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 513050 | 纳指ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 513500 | 纳指ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 513130 | 纳指ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 513220 | 纳指ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 513120 | 纳指ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 513190 | 纳指ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 513600 | 纳指ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 159920 | 纳指ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 510900 | 恒生ETF | SPY | SPDR S&P 500 ETF | 标普500 |
| 159941 | 欧美ETF | EFA | iShares EAFE ETF | 发达市场 |
| 159659 | 欧美ETF | EFA | iShares EAFE ETF | 发达市场 |
| 159632 | 欧美ETF | EFA | iShares EAFE ETF | 发达市场 |
| 159866 | 新兴市场ETF | EEM | iShares MSCI Emerging Markets | 新兴市场 |
| 513030 | 韩国ETF | EWY | iShares MSCI South Korea | 韩国市场 |
| 518880 | 黄金ETF | GLD | SPDR Gold Trust | 黄金 |
| 159937 | 全市场ETF | VTI | Vanguard Total Stock Market | 美股全市场 |
| 159985 | 全市场ETF | VTI | Vanguard Total Stock Market | 美股全市场 |
| 161226 | 全市场ETF | VTI | Vanguard Total Stock Market | 美股全市场 |
| 159980 | 全市场ETF | VTI | Vanguard Total Stock Market | 美股全市场 |

## 数据源优先级

1. **东方财富 API**（国内环境优先）
2. **Yahoo Finance API**（海外环境，通过美股映射）
3. **akshare**（增强）
4. **模拟数据**（兜底）

## 前端显示

当使用 Yahoo Finance 数据源时，前端会显示：
> ✅ 实时行情 — 数据来源: Yahoo Finance (美股映射)

## 修改说明

- 映射表定义在 `yfinance_client.py` 的 `ETF_SYMBOL_MAP` 字典中
- 如需添加新的映射关系，直接在字典中添加即可
- 修改后需要重新部署后端才能生效
