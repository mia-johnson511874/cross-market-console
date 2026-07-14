# A股ETF → 美股ETF 映射表

## 概述

由于海外服务器（PythonAnywhere）无法访问东方财富等国内数据源，本项目将 A 股 ETF 代码映射到功能类似的美股 ETF，通过 Yahoo Finance API 获取真实实时行情数据。

同时，新增了直接在美股市场上市、与 A股/港股市场相关的 ETF 品种。

## A股ETF → 美股ETF 映射关系

| A股代码 | A股名称 | 映射美股 | 美股名称 | 类型 |
|---------|---------|---------|---------|------|
| 513100 | 纳指ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 513050 | 纳指ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 513500 | 标普500ETF | SPY | SPDR S&P 500 ETF | 标普500 |
| 513130 | 恒生科技ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 513220 | 恒生互联网ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 513120 | 港股通50ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 513190 | 港股通金融ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 513600 | 恒生科技指数ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 159920 | 恒生ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 510900 | H股ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 159941 | 纳指ETF深 | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 159659 | 纳斯达克100ETF | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 159632 | 纳斯达克ETF沪 | QQQ | Invesco QQQ Trust | 纳斯达克 |
| 159866 | 日经ETF | EWJ | iShares MSCI Japan | 日本市场 |
| 513030 | 德国ETF | EWG | iShares MSCI Germany | 德国市场 |
| 518880 | 黄金ETF | GLD | SPDR Gold Trust | 黄金 |
| 159937 | 黄金ETF深 | GLD | SPDR Gold Trust | 黄金 |
| 159985 | 豆粕ETF | SOYB | Invesco DB Soybean Fund | 豆粕 |
| 161226 | 白银LOF | SLV | iShares Silver Trust | 白银 |
| 159980 | 有色金属ETF | COPX | Global X Copper Miners | 铜矿 |

## 新增美股ETF品种（直连Yahoo Finance）

| 美股代码 | 名称 | 类型 | 说明 |
|---------|------|------|------|
| CYB | 人民币ETF | 货币 | 跟踪人民币汇率 |
| ASHR | 沪深300ETF(美股) | A股 | 跟踪沪深300指数 |
| QQQ | 纳指ETF(美股) | 美股 | Invesco QQQ Trust |
| SPY | 标普500ETF(美股) | 美股 | SPDR S&P 500 ETF |
| EWH | 恒生ETF(美股) | 港股 | iShares MSCI Hong Kong |
| KWEB | 中国互联网ETF(美股) | 港股 | KraneShares CSI China Internet |
| CQQQ | 中国科技ETF(美股) | 港股 | Global X China Technology |

## 数据源优先级

1. **东方财富 API**（国内环境优先）
2. **Yahoo Finance API**（海外环境，通过美股映射）
3. **akshare**（增强）
4. **模拟数据**（兜底）

## 前端显示

当使用 Yahoo Finance 数据源时，前端会显示：
> ✅ 实时行情 — 数据来源: Yahoo Finance (美股映射)

## 修改说明

- 映射表定义在 `main.py` 的 `ETF_PRODUCTS` 列表中，每个品种包含 `yf_symbol` 字段
- 如需添加新的映射关系，直接在列表中添加即可
- 修改后需要重新部署后端才能生效
