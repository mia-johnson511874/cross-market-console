// 跨式/宽跨式期权下单页面
// 多头跨式(Straddle): 买入同行权价 CALL+PUT
// 多头宽跨式(Strangle): 买入不同行权价 CALL+PUT
// 数据来源: 复用系统 /api 代理 → 后端(东财/Yahoo/akshare) → 失败回退模拟档位

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { OptionProduct } from '../data/optionProducts';
import { optionProducts, marketTypeLabels } from '../data/optionProducts';
import {
  fetchOptionProductChain,
  fetchGridSnapshot,
  type ProductChainResponse,
} from '../services/marketData';
import {
  computePosition,
  generateAdjustmentPlans,
  generateExpertAdvice,
  daysToExpiryMonth,
  fallbackExpiryMonths,
  fallbackStrikes,
  bsPrice,
  impliedVol,
  straddleSelfTest,
  type OptionLeg,
  type PayoffPoint,
  type ExpertAdvice,
  type ExpertCandidate,
} from '../utils/straddleEngine';

interface StraddleOrderPageProps {
  onSubmit: (product: OptionProduct, order: StraddleOrder) => void;
  onCancel: () => void;
}

export interface StraddleOrder {
  productId: string;
  structure: 'straddle' | 'strangle';
  expiry: string;
  callStrike: number;
  putStrike: number;
  callPremium: number;
  putPremium: number;
  contracts: number;
  netDebit: number;
  maxLoss: number;
  lowerBreakeven: number | null;
  upperBreakeven: number | null;
}

type StructureMode = 'straddle' | 'strangle';

const groupedOptions = optionProducts.reduce(
  (acc, p) => {
    const cat = marketTypeLabels[p.marketType];
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  },
  {} as Record<string, OptionProduct[]>
);

/** 期权品种 → 网格品种ID (用于取标的实时价) */
function optionToGridId(optionId: string): string | null {
  const map: Record<string, string> = {
    'opt-50': 'a-50etf',
    'opt-300': 'a-300etf',
    'opt-300sz': 'a-300etf-sz',
    'opt-500': 'a-500etf',
    'opt-kc50': 'a-kc50',
    'opt-hstech': 'a-hstech',
    'opt-au': 'a-gold',
    'opt-ag': 'a-silver',
    'opt-cu': 'a-metal',
    'opt-m': 'a-doupo',
    'opt-rb': 'a-metal',
  };
  return map[optionId] ?? null;
}

function formatExpiry(yyyymm: string): string {
  return yyyymm.length >= 6 ? `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}` : yyyymm;
}

export default function StraddleOrderPage({ onSubmit, onCancel }: StraddleOrderPageProps) {
  const [product, setProduct] = useState<OptionProduct>(optionProducts[0]);
  const [mode, setMode] = useState<StructureMode>('straddle');

  // 行情状态
  const [chain, setChain] = useState<ProductChainResponse | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [priceSource, setPriceSource] = useState<string | undefined>(undefined);
  const [chainLoading, setChainLoading] = useState(false);

  // 下单参数
  const [expiry, setExpiry] = useState('');
  const [callStrike, setCallStrike] = useState(0);
  const [putStrike, setPutStrike] = useState(0);
  const [callPrem, setCallPrem] = useState(0);
  const [putPrem, setPutPrem] = useState(0);
  const [contracts, setContracts] = useState(1);
  const [confirmModal, setConfirmModal] = useState(false);

  const productRef = useRef(product);
  productRef.current = product;

  // 开发环境数值自检 (需求文档案例: 11C+19P → 3.94/26.06)
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.info('[straddle] engine self-test:', straddleSelfTest() ? 'PASS' : 'FAIL');
    }
  }, []);

  // 格式化精度
  const strikeDec = product.price > 100 ? 1 : 3;
  const premDec = product.price > 100 ? 2 : 4;
  const S = livePrice ?? product.price;

  // 到期月列表: 链上真实月份, 否则未来4个月
  const expiryMonths = useMemo(() => {
    if (chain && chain.expiry_months && chain.expiry_months.length > 0) {
      return chain.expiry_months;
    }
    return fallbackExpiryMonths();
  }, [chain]);

  const hasRealChain = useMemo(
    () => !!(chain && chain.contracts && chain.contracts.length > 0),
    [chain]
  );

  // 当前到期月下的行权价档位
  const strikes = useMemo(() => {
    if (hasRealChain && chain && expiry) {
      const set = new Set<number>();
      for (const c of chain.contracts) {
        if ((c.expiry === expiry || c.expiry.includes(expiry)) && c.strike > 0) {
          set.add(c.strike);
        }
      }
      const list = [...set].sort((a, b) => a - b);
      if (list.length >= 3) return list;
    }
    return fallbackStrikes(S);
  }, [hasRealChain, chain, expiry, S]);

  const daysToExpiry = useMemo(() => daysToExpiryMonth(expiry), [expiry]);

  // 链上权利金查询
  const lookupPremium = useCallback(
    (strike: number, type: 'call' | 'put'): number | null => {
      if (!hasRealChain || !chain) return null;
      const typeStr = type === 'call' ? '认购' : '认沽';
      const hit = chain.contracts.find(
        (c) =>
          (c.expiry === expiry || c.expiry.includes(expiry)) &&
          c.type.includes(typeStr) &&
          Math.abs(c.strike - strike) < Math.max(strike * 0.002, 1e-6) &&
          c.latest_price !== null &&
          c.latest_price > 0
      );
      return hit?.latest_price ?? null;
    },
    [hasRealChain, chain, expiry]
  );

  // 当前 IV 估计 (用于缺失价格的 BS 估算)
  const currentIv = useMemo(() => {
    if (callPrem > 0 && callStrike > 0) {
      const iv = impliedVol('call', callPrem, S, callStrike, daysToExpiry);
      if (iv) return iv;
    }
    if (putPrem > 0 && putStrike > 0) {
      const iv = impliedVol('put', putPrem, S, putStrike, daysToExpiry);
      if (iv) return iv;
    }
    return 0.25;
  }, [callPrem, putPrem, callStrike, putStrike, S, daysToExpiry]);

  /** 取权利金: 链上最新价优先, 否则 BS 估算 */
  const resolvePremium = useCallback(
    (strike: number, type: 'call' | 'put'): number => {
      const fromChain = lookupPremium(strike, type);
      if (fromChain !== null) return fromChain;
      return Math.round(bsPrice(type, S, strike, daysToExpiry, currentIv) * 10 ** premDec) / 10 ** premDec;
    },
    [lookupPremium, S, daysToExpiry, currentIv, premDec]
  );

  // 初始化默认行权价 (围绕现价)
  const applyDefaultStrikes = useCallback(
    (strikeList: number[], m: StructureMode, spot: number) => {
      const atmIdx = strikeList.reduce(
        (best, s, i) => (Math.abs(s - spot) < Math.abs(strikeList[best] - spot) ? i : best),
        0
      );
      let cs: number;
      let ps: number;
      if (m === 'straddle') {
        cs = ps = strikeList[atmIdx];
      } else {
        cs = strikeList[Math.min(atmIdx + 1, strikeList.length - 1)];
        ps = strikeList[Math.max(atmIdx - 1, 0)];
      }
      setCallStrike(cs);
      setPutStrike(ps);
      return { cs, ps };
    },
    []
  );

  // 拉取标的实时价
  const fetchSpot = useCallback(async () => {
    const gridId = optionToGridId(productRef.current.id);
    if (!gridId) return;
    const snap = await fetchGridSnapshot(gridId);
    if (snap && snap.live_price !== null) {
      setLivePrice(snap.live_price);
      setPriceSource(snap.source);
    } else {
      setLivePrice(null);
      setPriceSource(undefined);
    }
  }, []);

  // 拉取期权链
  const fetchChain = useCallback(async (p: OptionProduct) => {
    setChainLoading(true);
    const data = await fetchOptionProductChain(p.id);
    setChain(data);
    setChainLoading(false);
    if (data?.underlying_price) {
      setLivePrice(data.underlying_price);
    }
    return data;
  }, []);

  // 品种切换 / 首次加载
  useEffect(() => {
    setChain(null);
    setLivePrice(null);
    setPriceSource(undefined);
    const p = product;
    (async () => {
      const data = await fetchChain(p);
      await fetchSpot();
      const spot = data?.underlying_price ?? p.price;
      const months =
        data && data.expiry_months.length > 0 ? data.expiry_months : fallbackExpiryMonths();
      setExpiry(months[0]);
      // 用链上档位或合成档位设置默认行权价
      let strikeList: number[];
      if (data && data.contracts.length > 0) {
        const set = new Set<number>();
        for (const c of data.contracts) {
          if (
            (c.expiry === months[0] || c.expiry.includes(months[0])) &&
            c.strike > 0
          ) {
            set.add(c.strike);
          }
        }
        strikeList = [...set].sort((a, b) => a - b);
        if (strikeList.length < 3) strikeList = fallbackStrikes(spot);
      } else {
        strikeList = fallbackStrikes(spot);
      }
      const { cs, ps } = applyDefaultStrikes(strikeList, mode, spot);
      // 初始权利金: 链价优先
      const prem = (strike: number, type: 'call' | 'put') => {
        if (data && data.contracts.length > 0) {
          const typeStr = type === 'call' ? '认购' : '认沽';
          const hit = data.contracts.find(
            (c) =>
              (c.expiry === months[0] || c.expiry.includes(months[0])) &&
              c.type.includes(typeStr) &&
              Math.abs(c.strike - strike) < Math.max(strike * 0.002, 1e-6) &&
              c.latest_price !== null &&
              c.latest_price > 0
          );
          if (hit?.latest_price) return hit.latest_price;
        }
        return Math.round(bsPrice(type, spot, strike, 30, 0.25) * 10 ** premDec) / 10 ** premDec;
      };
      setCallPrem(prem(cs, 'call'));
      setPutPrem(prem(ps, 'put'));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  // 标的价轮询 (15s, 复用系统快照接口)
  useEffect(() => {
    const id = setInterval(fetchSpot, 15000);
    return () => clearInterval(id);
  }, [fetchSpot]);

  // 到期月切换 → 按新到期月重设档位与权利金
  const handleExpiryChange = useCallback(
    (newExpiry: string) => {
      setExpiry(newExpiry);
      // 计算新到期月下的档位
      let strikeList: number[];
      if (hasRealChain && chain) {
        const set = new Set<number>();
        for (const c of chain.contracts) {
          if ((c.expiry === newExpiry || c.expiry.includes(newExpiry)) && c.strike > 0) {
            set.add(c.strike);
          }
        }
        strikeList = [...set].sort((a, b) => a - b);
        if (strikeList.length < 3) strikeList = fallbackStrikes(S);
      } else {
        strikeList = fallbackStrikes(S);
      }
      const { cs, ps } = applyDefaultStrikes(strikeList, mode, S);
      // 权利金: 新到期月链价优先, 否则 BS 估算
      const days = daysToExpiryMonth(newExpiry);
      const prem = (strike: number, type: 'call' | 'put') => {
        if (hasRealChain && chain) {
          const typeStr = type === 'call' ? '认购' : '认沽';
          const hit = chain.contracts.find(
            (c) =>
              (c.expiry === newExpiry || c.expiry.includes(newExpiry)) &&
              c.type.includes(typeStr) &&
              Math.abs(c.strike - strike) < Math.max(strike * 0.002, 1e-6) &&
              c.latest_price !== null &&
              c.latest_price > 0
          );
          if (hit?.latest_price) return hit.latest_price;
        }
        return Math.round(bsPrice(type, S, strike, days, 0.25) * 10 ** premDec) / 10 ** premDec;
      };
      setCallPrem(prem(cs, 'call'));
      setPutPrem(prem(ps, 'put'));
    },
    [hasRealChain, chain, S, mode, applyDefaultStrikes, premDec]
  );

  // 行权价变更 → 自动填权利金
  const handleCallStrikeChange = useCallback(
    (strike: number) => {
      setCallStrike(strike);
      setCallPrem(resolvePremium(strike, 'call'));
      if (mode === 'straddle') {
        setPutStrike(strike);
        setPutPrem(resolvePremium(strike, 'put'));
      }
    },
    [mode, resolvePremium]
  );

  const handlePutStrikeChange = useCallback(
    (strike: number) => {
      setPutStrike(strike);
      setPutPrem(resolvePremium(strike, 'put'));
      if (mode === 'straddle') {
        setCallStrike(strike);
        setCallPrem(resolvePremium(strike, 'call'));
      }
    },
    [mode, resolvePremium]
  );

  // 结构切换
  const handleModeChange = useCallback(
    (m: StructureMode) => {
      setMode(m);
      applyDefaultStrikes(strikes, m, S);
      const atm = strikes.reduce((a, b) => (Math.abs(b - S) < Math.abs(a - S) ? b : a));
      if (m === 'straddle') {
        setCallPrem(resolvePremium(atm, 'call'));
        setPutPrem(resolvePremium(atm, 'put'));
      } else {
        const atmIdx = strikes.findIndex((s) => s === atm);
        const cs = strikes[Math.min(atmIdx + 1, strikes.length - 1)];
        const ps = strikes[Math.max(atmIdx - 1, 0)];
        setCallPrem(resolvePremium(cs, 'call'));
        setPutPrem(resolvePremium(ps, 'put'));
      }
    },
    [strikes, S, applyDefaultStrikes, resolvePremium]
  );

  // 刷新行情
  const handleRefresh = useCallback(async () => {
    await fetchChain(product);
    await fetchSpot();
    setCallPrem(resolvePremium(callStrike, 'call'));
    setPutPrem(resolvePremium(putStrike, 'put'));
  }, [product, fetchChain, fetchSpot, resolvePremium, callStrike, putStrike]);

  // 当前组合指标
  const legs: OptionLeg[] = useMemo(
    () => [
      { side: 'buy', type: 'call', strike: callStrike, premium: callPrem },
      { side: 'buy', type: 'put', strike: putStrike, premium: putPrem },
    ],
    [callStrike, putStrike, callPrem, putPrem]
  );

  const metrics = useMemo(
    () =>
      computePosition({
        underlyingPrice: S,
        legs,
        contracts,
        pointValue: product.pointValue,
        daysToExpiry,
        iv: currentIv,
      }),
    [S, legs, contracts, product.pointValue, daysToExpiry, currentIv]
  );

  // 备选调仓方案
  const plans = useMemo(
    () =>
      generateAdjustmentPlans({
        underlyingPrice: S,
        callStrike,
        putStrike,
        callPremium: callPrem,
        putPremium: putPrem,
        strikes,
        contracts,
        pointValue: product.pointValue,
        daysToExpiry,
        lookupPremium,
      }),
    [S, callStrike, putStrike, callPrem, putPrem, strikes, contracts, product.pointValue, daysToExpiry, lookupPremium]
  );

  // 专家建议: 扫描候选组合, 给出权利金最小/到期收益最大/综合最优三档推荐
  const expertAdvice = useMemo<ExpertAdvice>(
    () =>
      generateExpertAdvice({
        underlyingPrice: S,
        callStrike,
        putStrike,
        callPremium: callPrem,
        putPremium: putPrem,
        strikes,
        contracts,
        pointValue: product.pointValue,
        daysToExpiry,
        lookupPremium,
      }),
    [S, callStrike, putStrike, callPrem, putPrem, strikes, contracts, product.pointValue, daysToExpiry, lookupPremium]
  );

  // 一键应用专家候选(仅2腿多头跨式/宽跨式可直接套入下单表单)
  const applyExpertCandidate = useCallback((c: ExpertCandidate) => {
    const call = c.legs.find((l) => l.side === 'buy' && l.type === 'call');
    const put = c.legs.find((l) => l.side === 'buy' && l.type === 'put');
    if (!call || !put) return;
    setCallStrike(call.strike);
    setPutStrike(put.strike);
    setCallPrem(call.premium);
    setPutPrem(put.premium);
    setMode(Math.abs(call.strike - put.strike) < 1e-9 ? 'straddle' : 'strangle');
  }, []);
  const isExpertApplicable = (c: ExpertCandidate) =>
    c.legs.length === 2 && c.legs.every((l) => l.side === 'buy');
  // 现价到最近平衡点所需波动幅度
  const requiredMovePct = useMemo(() => {
    const moves: number[] = [];
    if (metrics.lowerBreakeven !== null && metrics.lowerBreakeven < S) {
      moves.push(((S - metrics.lowerBreakeven) / S) * 100);
    }
    if (metrics.upperBreakeven !== null && metrics.upperBreakeven > S) {
      moves.push(((metrics.upperBreakeven - S) / S) * 100);
    }
    return moves.length > 0 ? Math.min(...moves) : null;
  }, [metrics, S]);

  // 应用备选方案
  const applyPlan = useCallback(
    (planId: string) => {
      const plan = plans.find((p) => p.id === planId);
      if (!plan || !plan.applicable) return;
      const call = plan.legs.find((l) => l.side === 'buy' && l.type === 'call');
      const put = plan.legs.find((l) => l.side === 'buy' && l.type === 'put');
      if (!call || !put) return;
      setCallStrike(call.strike);
      setPutStrike(put.strike);
      setCallPrem(call.premium);
      setPutPrem(put.premium);
      setMode(Math.abs(call.strike - put.strike) < 1e-9 ? 'straddle' : 'strangle');
    },
    [plans]
  );

  const handleSubmit = () => setConfirmModal(true);

  const confirmOrder = () => {
    const order: StraddleOrder = {
      productId: product.id,
      structure: metrics.structure === 'straddle' ? 'straddle' : 'strangle',
      expiry,
      callStrike,
      putStrike,
      callPremium: callPrem,
      putPremium: putPrem,
      contracts,
      netDebit: metrics.netDebit,
      maxLoss: metrics.maxLoss,
      lowerBreakeven: metrics.lowerBreakeven,
      upperBreakeven: metrics.upperBreakeven,
    };
    onSubmit(product, order);
    setConfirmModal(false);
  };

  const fmtMoney = (v: number) =>
    `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="order-page">
      <div className="order-header">
        <h2>🎯 跨式 / 宽跨式期权下单</h2>
        <button className="btn btn-cancel" onClick={onCancel}>
          ← 返回
        </button>
      </div>

      <div className="order-content">
        {/* ============ 基本信息 ============ */}
        <div className="order-section">
          <h3>基本信息</h3>
          <div className="form-row">
            <div className="form-group">
              <label>期权品种</label>
              <select
                value={product.id}
                onChange={(e) => {
                  const p = optionProducts.find((o) => o.id === e.target.value);
                  if (p) setProduct(p);
                }}
              >
                {Object.entries(groupedOptions).map(([cat, products]) => (
                  <optgroup key={cat} label={cat}>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.code})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>组合结构</label>
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    checked={mode === 'straddle'}
                    onChange={() => handleModeChange('straddle')}
                  />
                  跨式 Straddle (同行权价)
                </label>
                <label>
                  <input
                    type="radio"
                    checked={mode === 'strangle'}
                    onChange={() => handleModeChange('strangle')}
                  />
                  宽跨式 Strangle (不同行权价)
                </label>
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>标的实时价格</label>
              <div className="input-group">
                <span className="input-prefix">¥</span>
                <input type="number" value={S.toFixed(strikeDec)} readOnly />
                <button className="btn btn-small" onClick={handleRefresh} disabled={chainLoading}>
                  {chainLoading ? '刷新中…' : '🔄 刷新'}
                </button>
              </div>
              <span className={`chain-source ${hasRealChain ? 'source-live' : 'source-sim'}`}>
                {hasRealChain
                  ? `✅ 实时期权链 (${priceSource ?? chain?.underlying_name ?? 'backend'})`
                  : '📡 模拟行权档位 (链不可用, BS估算权利金)'}
              </span>
            </div>

            <div className="form-group">
              <label>到期月份</label>
              <select value={expiry} onChange={(e) => handleExpiryChange(e.target.value)}>
                {expiryMonths.map((m) => (
                  <option key={m} value={m}>
                    {formatExpiry(m)} (约{daysToExpiryMonth(m)}天)
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ============ 行权价与权利金 ============ */}
        <div className="order-section">
          <h3>行权价与权利金</h3>
          <div className="form-row">
            <div className="form-group">
              <label>CALL 行权价 (买入认购)</label>
              <select
                value={callStrike}
                onChange={(e) => handleCallStrikeChange(parseFloat(e.target.value))}
              >
                {strikes.map((s) => (
                  <option key={s} value={s}>
                    {s.toFixed(strikeDec)}
                    {Math.abs(s - S) / S < 0.005 ? ' (平值)' : s > S ? ' (虚值CALL)' : ' (实值CALL)'}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>PUT 行权价 (买入认沽)</label>
              <select
                value={putStrike}
                onChange={(e) => handlePutStrikeChange(parseFloat(e.target.value))}
              >
                {strikes.map((s) => (
                  <option key={s} value={s}>
                    {s.toFixed(strikeDec)}
                    {Math.abs(s - S) / S < 0.005 ? ' (平值)' : s < S ? ' (虚值PUT)' : ' (实值PUT)'}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>合约数量</label>
              <div className="input-group">
                <input
                  type="number"
                  value={contracts}
                  onChange={(e) => setContracts(Math.max(1, parseInt(e.target.value) || 1))}
                  min="1"
                  max="100"
                />
                <span className="input-suffix">张</span>
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>CALL 权利金</label>
              <div className="input-group">
                <input
                  type="number"
                  value={callPrem.toFixed(premDec)}
                  onChange={(e) => setCallPrem(parseFloat(e.target.value) || 0)}
                  step="0.0001"
                />
                <span className="input-suffix">pts</span>
              </div>
            </div>

            <div className="form-group">
              <label>PUT 权利金</label>
              <div className="input-group">
                <input
                  type="number"
                  value={putPrem.toFixed(premDec)}
                  onChange={(e) => setPutPrem(parseFloat(e.target.value) || 0)}
                  step="0.0001"
                />
                <span className="input-suffix">pts</span>
              </div>
            </div>

            <div className="form-group">
              <label>行权价差</label>
              <div className="strike-gap">
                {Math.abs(callStrike - putStrike).toFixed(strikeDec)}
                <span className="text-muted">
                  {metrics.structure === 'straddle' ? ' (跨式, 价差=0)' : ' (宽跨式)'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ============ 组合指标 ============ */}
        <div className="order-section">
          <h3>组合指标</h3>
          <div className="straddle-metrics">
            <div className="metric-card">
              <span className="metric-card-label">净权利金支出</span>
              <span className="metric-card-value pnl-negative">{fmtMoney(metrics.netDebit)}</span>
            </div>
            <div className="metric-card">
              <span className="metric-card-label">最大亏损</span>
              <span className="metric-card-value pnl-negative">{fmtMoney(metrics.maxLoss)}</span>
            </div>
            <div className="metric-card">
              <span className="metric-card-label">最大收益</span>
              <span className="metric-card-value pnl-positive">
                {metrics.profitCapped ? fmtMoney(metrics.maxProfit) : '无限'}
              </span>
            </div>
            <div className="metric-card highlight">
              <span className="metric-card-label">下方平衡点</span>
              <span className="metric-card-value">
                {metrics.lowerBreakeven !== null ? metrics.lowerBreakeven.toFixed(strikeDec) : '—'}
              </span>
            </div>
            <div className="metric-card highlight">
              <span className="metric-card-label">上方平衡点</span>
              <span className="metric-card-value">
                {metrics.upperBreakeven !== null ? metrics.upperBreakeven.toFixed(strikeDec) : '—'}
              </span>
            </div>
            <div className="metric-card">
              <span className="metric-card-label">平衡点区间宽度</span>
              <span className="metric-card-value">
                {metrics.intervalWidth !== null ? metrics.intervalWidth.toFixed(strikeDec) : '—'}
              </span>
            </div>
            <div className="metric-card">
              <span className="metric-card-label">盈利所需最小波动</span>
              <span className="metric-card-value">
                {requiredMovePct !== null ? `±${requiredMovePct.toFixed(2)}%` : '已处于盈利区'}
              </span>
            </div>
            <div className="metric-card">
              <span className="metric-card-label">剩余到期天数</span>
              <span className="metric-card-value">{daysToExpiry} 天</span>
            </div>
          </div>
        </div>

        {/* ============ 到期损益图 ============ */}
        <div className="order-section">
          <h3>到期损益图</h3>
          <PayoffChart
            curve={metrics.payoffCurve}
            spot={S}
            lowerBE={metrics.lowerBreakeven}
            upperBE={metrics.upperBreakeven}
            strikeDec={strikeDec}
          />
        </div>

        {/* ============ 希腊字母 ============ */}
        <div className="order-section">
          <h3>希腊字母 (Black-Scholes, IV≈{(currentIv * 100).toFixed(1)}%)</h3>
          <div className="greeks-grid">
            <div className="greek-item">
              <span className="greek-label">Δ Delta (每股)</span>
              <span className={`greek-value ${metrics.greeks.delta >= 0 ? 'positive' : 'negative'}`}>
                {metrics.greeks.delta.toFixed(4)}
              </span>
            </div>
            <div className="greek-item">
              <span className="greek-label">Γ Gamma (每股)</span>
              <span className="greek-value">{metrics.greeks.gamma.toFixed(4)}</span>
            </div>
            <div className="greek-item">
              <span className="greek-label">Θ Theta (仓位/天)</span>
              <span className={`greek-value ${metrics.greeks.positionTheta >= 0 ? 'positive' : 'negative'}`}>
                {fmtMoney(metrics.greeks.positionTheta)}
              </span>
            </div>
            <div className="greek-item">
              <span className="greek-label">Ν Vega (仓位/1%IV)</span>
              <span className="greek-value positive">
                +{fmtMoney(metrics.greeks.positionVega)}
              </span>
            </div>
          </div>
        </div>

        {/* ============ 专家建议 ============ */}
        <div className="order-section expert-section">
          <h3>🧠 专家建议 · 权利金最小 / 到期收益最大 / 综合最优</h3>
          <p className="expert-reasoning">{expertAdvice.reasoning}</p>
          <div className="straddle-metrics expert-cards">
            <div className="metric-card expert-card highlight">
              <span className="metric-card-label">① 权利金最小</span>
              <span className="metric-card-value">{expertAdvice.bestPremium.title}</span>
              <div className="expert-card-meta">
                <span>净支出 <b className="pnl-negative">{fmtMoney(expertAdvice.bestPremium.netDebit)}</b></span>
                <span>预期收益 <b className={expertAdvice.bestPremium.projectedProfit >= 0 ? 'pnl-positive' : 'pnl-negative'}>{fmtMoney(expertAdvice.bestPremium.projectedProfit)}</b></span>
                <span>风险收益比 <b>{expertAdvice.bestPremium.rewardRisk.toFixed(2)}</b></span>
              </div>
              {isExpertApplicable(expertAdvice.bestPremium) && (
                <button className="btn btn-small" onClick={() => applyExpertCandidate(expertAdvice.bestPremium)}>应用到表单</button>
              )}
            </div>
            <div className="metric-card expert-card">
              <span className="metric-card-label">② 到期收益最大</span>
              <span className="metric-card-value">{expertAdvice.bestProfit.title}</span>
              <div className="expert-card-meta">
                <span>净支出 <b className="pnl-negative">{fmtMoney(expertAdvice.bestProfit.netDebit)}</b></span>
                <span>预期收益 <b className="pnl-positive">{fmtMoney(expertAdvice.bestProfit.projectedProfit)}</b></span>
                <span>风险收益比 <b>{expertAdvice.bestProfit.rewardRisk.toFixed(2)}</b></span>
              </div>
              {isExpertApplicable(expertAdvice.bestProfit) && (
                <button className="btn btn-small" onClick={() => applyExpertCandidate(expertAdvice.bestProfit)}>应用到表单</button>
              )}
            </div>
            <div className="metric-card expert-card highlight">
              <span className="metric-card-label">③ 综合最优 (专家推荐)</span>
              <span className="metric-card-value">{expertAdvice.bestOverall.title}</span>
              <div className="expert-card-meta">
                <span>净支出 <b className="pnl-negative">{fmtMoney(expertAdvice.bestOverall.netDebit)}</b></span>
                <span>预期收益 <b className={expertAdvice.bestOverall.projectedProfit >= 0 ? 'pnl-positive' : 'pnl-negative'}>{fmtMoney(expertAdvice.bestOverall.projectedProfit)}</b></span>
                <span>风险收益比 <b>{expertAdvice.bestOverall.rewardRisk.toFixed(2)}</b></span>
              </div>
              {isExpertApplicable(expertAdvice.bestOverall) && (
                <button className="btn btn-small btn-submit" onClick={() => applyExpertCandidate(expertAdvice.bestOverall)}>应用到表单</button>
              )}
            </div>
          </div>
          <div className="plan-table-wrapper">
            <table className="plan-table">
              <thead>
                <tr>
                  <th>组合</th>
                  <th>结构</th>
                  <th>净支出</th>
                  <th>预期收益</th>
                  <th>最大亏损</th>
                  <th>风险收益比</th>
                  <th>平衡点宽度</th>
                  <th>特点</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {expertAdvice.candidates.map((c) => (
                  <tr key={c.id}>
                    <td>{c.title}</td>
                    <td>{c.structureLabel}</td>
                    <td className="pnl-negative">{fmtMoney(c.netDebit)}</td>
                    <td className={c.projectedProfit >= 0 ? 'pnl-positive' : 'pnl-negative'}>{fmtMoney(c.projectedProfit)}</td>
                    <td className="pnl-negative">{fmtMoney(c.maxLoss)}</td>
                    <td>{c.rewardRisk.toFixed(2)}</td>
                    <td>{c.breakevenWidth !== null ? c.breakevenWidth.toFixed(strikeDec) : '—'}</td>
                    <td className="plan-note">{c.note}</td>
                    <td>
                      {isExpertApplicable(c) ? (
                        <button className="btn btn-small" onClick={() => applyExpertCandidate(c)}>应用</button>
                      ) : (
                        <span className="text-muted">仅参考</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* ============ 收窄平衡点方案对比 ============ */}
        <div className="order-section">
          <h3>🔧 收窄盈亏平衡点 · 方案对比</h3>
          <div className="plan-table-wrapper">
            <table className="plan-table">
              <thead>
                <tr>
                  <th>方案</th>
                  <th>组合</th>
                  <th>净支出</th>
                  <th>平衡点区间</th>
                  <th>区间宽度</th>
                  <th>最大亏损</th>
                  <th>特点</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr className="plan-current">
                  <td>当前组合</td>
                  <td>
                    {callStrike.toFixed(strikeDec)}C + {putStrike.toFixed(strikeDec)}P
                  </td>
                  <td className="pnl-negative">{fmtMoney(metrics.netDebit)}</td>
                  <td>
                    {metrics.lowerBreakeven?.toFixed(strikeDec) ?? '—'} ~{' '}
                    {metrics.upperBreakeven?.toFixed(strikeDec) ?? '—'}
                  </td>
                  <td>{metrics.intervalWidth?.toFixed(strikeDec) ?? '—'}</td>
                  <td className="pnl-negative">{fmtMoney(metrics.maxLoss)}</td>
                  <td>—</td>
                  <td>—</td>
                </tr>
                {plans.map((plan) => (
                  <tr key={plan.id}>
                    <td>{plan.title}</td>
                    <td>
                      {plan.legs
                        .map(
                          (l) =>
                            `${l.side === 'sell' ? '卖' : ''}${l.strike.toFixed(strikeDec)}${
                              l.type === 'call' ? 'C' : 'P'
                            }`
                        )
                        .join(' + ')}
                    </td>
                    <td className="pnl-negative">{fmtMoney(plan.metrics.netDebit)}</td>
                    <td>
                      {plan.metrics.lowerBreakeven?.toFixed(strikeDec) ?? '—'} ~{' '}
                      {plan.metrics.upperBreakeven?.toFixed(strikeDec) ?? '—'}
                    </td>
                    <td>
                      {plan.metrics.intervalWidth?.toFixed(strikeDec) ?? '—'}
                      {plan.metrics.intervalWidth !== null && metrics.intervalWidth !== null && (
                        <span
                          className={
                            plan.metrics.intervalWidth < metrics.intervalWidth
                              ? 'pnl-positive'
                              : 'pnl-negative'
                          }
                        >
                          {' '}
                          ({plan.metrics.intervalWidth < metrics.intervalWidth ? '窄' : '宽'}
                          {Math.abs(
                            ((plan.metrics.intervalWidth - metrics.intervalWidth) /
                              metrics.intervalWidth) *
                              100
                          ).toFixed(0)}
                          %)
                        </span>
                      )}
                    </td>
                    <td className="pnl-negative">{fmtMoney(plan.metrics.maxLoss)}</td>
                    <td className="plan-note">{plan.note}</td>
                    <td>
                      {plan.applicable ? (
                        <button className="btn btn-small" onClick={() => applyPlan(plan.id)}>
                          应用
                        </button>
                      ) : (
                        <span className="text-muted">仅参考</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ============ 双腿结构预览 ============ */}
        <div className="order-section">
          <h3>双腿结构预览</h3>
          <div className="option-legs">
            <div className="leg-row leg-red">
              <span className="leg-tag tag-red">买入</span>
              <span className="leg-name">认购 CALL</span>
              <span className="leg-strike">行权价: {callStrike.toFixed(strikeDec)}</span>
              <span className="leg-premium">-{callPrem.toFixed(premDec)} pts</span>
            </div>
            <div className="leg-row leg-red">
              <span className="leg-tag tag-red">买入</span>
              <span className="leg-name">认沽 PUT</span>
              <span className="leg-strike">行权价: {putStrike.toFixed(strikeDec)}</span>
              <span className="leg-premium">-{putPrem.toFixed(premDec)} pts</span>
            </div>
          </div>
        </div>

        {/* ============ 下单预览 ============ */}
        <div className="order-section">
          <h3>下单预览</h3>
          <div className="preview-table">
            <div className="preview-row">
              <span className="preview-label">品种</span>
              <span className="preview-value">
                {product.name} ({product.code})
              </span>
            </div>
            <div className="preview-row">
              <span className="preview-label">结构</span>
              <span className="preview-value">
                {metrics.structure === 'straddle' ? '跨式 Straddle (同行权价)' : '宽跨式 Strangle'}
              </span>
            </div>
            <div className="preview-row">
              <span className="preview-label">到期月份</span>
              <span className="preview-value">
                {formatExpiry(expiry)} (约{daysToExpiry}天)
              </span>
            </div>
            <div className="preview-row">
              <span className="preview-label">买入 CALL</span>
              <span className="preview-value">
                {callStrike.toFixed(strikeDec)} @ {callPrem.toFixed(premDec)}
              </span>
            </div>
            <div className="preview-row">
              <span className="preview-label">买入 PUT</span>
              <span className="preview-value">
                {putStrike.toFixed(strikeDec)} @ {putPrem.toFixed(premDec)}
              </span>
            </div>
            <div className="preview-row">
              <span className="preview-label">合约数量</span>
              <span className="preview-value">{contracts} 张</span>
            </div>
            <div className="preview-row preview-total">
              <span className="preview-label">净权利金支出</span>
              <span className="preview-value pnl-negative">-{fmtMoney(metrics.netDebit)}</span>
            </div>
            <div className="preview-row">
              <span className="preview-label">盈亏平衡点</span>
              <span className="preview-value">
                {metrics.lowerBreakeven?.toFixed(strikeDec) ?? '—'} ~{' '}
                {metrics.upperBreakeven?.toFixed(strikeDec) ?? '—'}
              </span>
            </div>
            <div className="preview-row">
              <span className="preview-label">最大亏损</span>
              <span className="preview-value pnl-negative">-{fmtMoney(metrics.maxLoss)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="order-footer">
        <button className="btn btn-cancel" onClick={onCancel}>
          取消
        </button>
        <button className="btn btn-submit" onClick={handleSubmit}>
          📝 提交订单
        </button>
      </div>

      {confirmModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>确认下单</h3>
            <p>
              您即将提交以下{metrics.structure === 'straddle' ? '跨式' : '宽跨式'}期权订单：
            </p>
            <div className="modal-content">
              <div className="modal-row">
                <span>品种：</span>
                <span>
                  {product.name} ({product.code})
                </span>
              </div>
              <div className="modal-row">
                <span>到期：</span>
                <span>{formatExpiry(expiry)}</span>
              </div>
              <div className="modal-row">
                <span>买入CALL：</span>
                <span>
                  {callStrike.toFixed(strikeDec)} @ {callPrem.toFixed(premDec)}
                </span>
              </div>
              <div className="modal-row">
                <span>买入PUT：</span>
                <span>
                  {putStrike.toFixed(strikeDec)} @ {putPrem.toFixed(premDec)}
                </span>
              </div>
              <div className="modal-row">
                <span>合约数量：</span>
                <span>{contracts} 张</span>
              </div>
              <div className="modal-row">
                <span>净权利金：</span>
                <span className="pnl-negative">-{fmtMoney(metrics.netDebit)}</span>
              </div>
              <div className="modal-row">
                <span>平衡点：</span>
                <span>
                  {metrics.lowerBreakeven?.toFixed(strikeDec) ?? '—'} ~{' '}
                  {metrics.upperBreakeven?.toFixed(strikeDec) ?? '—'}
                </span>
              </div>
            </div>
            <p className="modal-warning">⚠️ 此操作仅为模拟下单，不涉及真实交易</p>
            <div className="modal-buttons">
              <button className="btn btn-cancel" onClick={() => setConfirmModal(false)}>
                返回修改
              </button>
              <button className="btn btn-submit" onClick={confirmOrder}>
                确认提交
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 到期损益图 (内联SVG) ====================

interface PayoffChartProps {
  curve: PayoffPoint[];
  spot: number;
  lowerBE: number | null;
  upperBE: number | null;
  strikeDec: number;
}

function PayoffChart({ curve, spot, lowerBE, upperBE, strikeDec }: PayoffChartProps) {
  const W = 640;
  const H = 230;
  const PAD_L = 62;
  const PAD_R = 16;
  const PAD_T = 14;
  const PAD_B = 30;

  if (curve.length < 2) return null;

  const prices = curve.map((p) => p.price);
  const pnls = curve.map((p) => p.pnl);
  const minX = Math.min(...prices);
  const maxX = Math.max(...prices);
  let minY = Math.min(...pnls);
  let maxY = Math.max(...pnls);
  if (maxY - minY < 1e-9) {
    maxY += 1;
    minY -= 1;
  }
  const padY = (maxY - minY) * 0.12;
  minY -= padY;
  maxY += padY;

  const x = (price: number) => PAD_L + ((price - minX) / (maxX - minX)) * (W - PAD_L - PAD_R);
  const y = (pnl: number) => PAD_T + (1 - (pnl - minY) / (maxY - minY)) * (H - PAD_T - PAD_B);

  const linePath = curve
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.price).toFixed(1)},${y(p.pnl).toFixed(1)}`)
    .join(' ');

  // 盈/亏区域填充
  const zeroY = y(0);
  const profitArea =
    `${linePath} L${x(maxX).toFixed(1)},${zeroY.toFixed(1)} L${x(minX).toFixed(1)},${zeroY.toFixed(1)} Z`;

  const yTicks = 4;
  const money = (v: number) =>
    Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}万` : v.toFixed(0);

  return (
    <div className="payoff-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {/* 网格与Y轴刻度 */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = minY + ((maxY - minY) * i) / yTicks;
          return (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y(v)}
                y2={y(v)}
                stroke="rgba(128,128,128,0.18)"
                strokeDasharray="3,4"
              />
              <text x={PAD_L - 6} y={y(v) + 4} textAnchor="end" className="chart-tick">
                {money(v)}
              </text>
            </g>
          );
        })}

        {/* 盈利区域 */}
        <path d={profitArea} fill="rgba(34,197,94,0.10)" clipPath="url(#pnl-clip)" />
        <clipPath id="pnl-clip">
          <rect x={PAD_L} y={PAD_T} width={W - PAD_L - PAD_R} height={zeroY - PAD_T} />
        </clipPath>

        {/* 零轴 */}
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={zeroY}
          y2={zeroY}
          stroke="rgba(128,128,128,0.6)"
          strokeWidth="1"
        />

        {/* 损益曲线 */}
        <path d={linePath} fill="none" stroke="#6366f1" strokeWidth="2.2" />

        {/* 平衡点标记 */}
        {lowerBE !== null && lowerBE >= minX && lowerBE <= maxX && (
          <g>
            <line
              x1={x(lowerBE)}
              x2={x(lowerBE)}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke="#22c55e"
              strokeDasharray="5,4"
            />
            <text x={x(lowerBE)} y={H - PAD_B + 14} textAnchor="middle" className="chart-be">
              下平衡 {lowerBE.toFixed(strikeDec)}
            </text>
          </g>
        )}
        {upperBE !== null && upperBE >= minX && upperBE <= maxX && (
          <g>
            <line
              x1={x(upperBE)}
              x2={x(upperBE)}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke="#22c55e"
              strokeDasharray="5,4"
            />
            <text x={x(upperBE)} y={H - PAD_B + 14} textAnchor="middle" className="chart-be">
              上平衡 {upperBE.toFixed(strikeDec)}
            </text>
          </g>
        )}

        {/* 现价标记 */}
        {spot >= minX && spot <= maxX && (
          <g>
            <line
              x1={x(spot)}
              x2={x(spot)}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke="#3b82f6"
              strokeWidth="1.6"
            />
            <text x={x(spot)} y={PAD_T + 10} textAnchor="middle" className="chart-spot">
              现价 {spot.toFixed(strikeDec)}
            </text>
          </g>
        )}
      </svg>
      <div className="chart-legend">
        <span className="legend-item">
          <i className="legend-line legend-pnl" /> 到期损益
        </span>
        <span className="legend-item">
          <i className="legend-line legend-be" /> 盈亏平衡点
        </span>
        <span className="legend-item">
          <i className="legend-line legend-spot" /> 标的现价
        </span>
        <span className="legend-item text-muted">绿色区域 = 盈利区</span>
      </div>
    </div>
  );
}
