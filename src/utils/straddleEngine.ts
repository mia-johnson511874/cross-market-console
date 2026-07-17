// 跨式/宽跨式期权计算引擎
// 多头跨式(Straddle: 同行权价 买CALL+买PUT) / 多头宽跨式(Strangle: 不同行权价)
// 平衡点公式(到期):
//   下方平衡点 = PUT行权价 - 每股净权利金
//   上方平衡点 = CALL行权价 + 每股净权利金
// 备选调仓方案(收窄平衡点): 转平值跨式 / 缩小行权价差 / 降低权利金 / 卖外侧收权利金

// ==================== 类型 ====================

export interface OptionLeg {
  side: 'buy' | 'sell';
  type: 'call' | 'put';
  strike: number;
  premium: number; // 每股(每份)权利金
}

export interface PositionInput {
  underlyingPrice: number;
  legs: OptionLeg[];
  contracts: number; // 张数
  pointValue: number; // 每点价值(如 ETF期权 10000份/张)
  daysToExpiry: number;
  iv?: number; // 年化波动率, 默认 0.25
}

export interface GreeksResult {
  delta: number; // 组合每股 Delta
  gamma: number; // 组合每股 Gamma
  thetaPerDay: number; // 每股每天 Theta
  vegaPer1Pct: number; // 每股每 1% 波动率 Vega
  positionTheta: number; // 整个仓位每天时间损耗(元)
  positionVega: number; // 整个仓位每 1% IV 变动盈亏(元)
}

export interface PayoffPoint {
  price: number;
  pnl: number;
}

export interface PositionMetrics {
  structure: 'straddle' | 'strangle' | 'custom';
  debitPerShare: number; // 每股净权利金(支出为正)
  netDebit: number; // 总净支出(元)
  maxLoss: number; // 最大亏损(元)
  maxProfit: number; // 最大收益(元), Infinity 表示无限
  profitCapped: boolean; // 收益是否被封顶
  lowerBreakeven: number | null;
  upperBreakeven: number | null;
  intervalWidth: number | null; // 上平衡点 - 下平衡点
  greeks: GreeksResult;
  payoffCurve: PayoffPoint[];
}

export interface AdjustmentPlan {
  id: 'atm-straddle' | 'narrow-gap' | 'cheaper' | 'sell-wings';
  title: string;
  description: string;
  note: string; // 特点/代价
  applicable: boolean; // 是否可一键应用到下单表单(false = 仅展示)
  legs: OptionLeg[];
  metrics: PositionMetrics;
}

// ==================== 数学工具 ====================

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** 标准正态概率密度 */
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/** 误差函数近似 (Abramowitz-Stegun 7.1.26) */
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** 标准正态累积分布 */
export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

// ==================== Black-Scholes (欧式, 无股息) ====================

const RISK_FREE = 0.02; // 无风险利率
const DEFAULT_IV = 0.25;

function bsD1(S: number, K: number, T: number, sigma: number): number {
  return (Math.log(S / K) + (RISK_FREE + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
}

/** BS 理论价格 */
export function bsPrice(
  type: 'call' | 'put',
  S: number,
  K: number,
  daysToExpiry: number,
  sigma: number = DEFAULT_IV
): number {
  const T = Math.max(daysToExpiry, 1) / 365;
  const d1 = bsD1(S, K, T, sigma);
  const d2 = d1 - sigma * Math.sqrt(T);
  const df = Math.exp(-RISK_FREE * T);
  if (type === 'call') {
    return Math.max(S * normCdf(d1) - K * df * normCdf(d2), 0);
  }
  return Math.max(K * df * normCdf(-d2) - S * normCdf(-d1), 0);
}

/** 由市场价格反推隐含波动率 (二分法) */
export function impliedVol(
  type: 'call' | 'put',
  marketPrice: number,
  S: number,
  K: number,
  daysToExpiry: number
): number | null {
  if (marketPrice <= 0 || S <= 0 || K <= 0) return null;
  // 内在价值检查: 价格低于内在价值时无法反推
  const intrinsic = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  if (marketPrice < intrinsic * 0.98) return null;

  let lo = 0.01;
  let hi = 3.0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const price = bsPrice(type, S, K, daysToExpiry, mid);
    if (Math.abs(price - marketPrice) < 1e-6) return mid;
    if (price < marketPrice) lo = mid;
    else hi = mid;
  }
  const finalPrice = bsPrice(type, S, K, daysToExpiry, (lo + hi) / 2);
  return Math.abs(finalPrice - marketPrice) / marketPrice < 0.05 ? (lo + hi) / 2 : null;
}

/** 单腿希腊字母 (每股) */
function legGreeks(
  leg: OptionLeg,
  S: number,
  daysToExpiry: number,
  sigma: number
): { delta: number; gamma: number; theta: number; vega: number } {
  const T = Math.max(daysToExpiry, 1) / 365;
  const sqrtT = Math.sqrt(T);
  const d1 = bsD1(S, leg.strike, T, sigma);
  const d2 = d1 - sigma * sqrtT;
  const pdf = normPdf(d1);
  const df = Math.exp(-RISK_FREE * T);

  const gamma = pdf / (S * sigma * sqrtT);
  const vega = (S * pdf * sqrtT) / 100; // 每 1% IV

  let delta: number;
  let theta: number;
  if (leg.type === 'call') {
    delta = normCdf(d1);
    theta =
      (-(S * pdf * sigma) / (2 * sqrtT) - RISK_FREE * leg.strike * df * normCdf(d2)) / 365;
  } else {
    delta = normCdf(d1) - 1;
    theta =
      (-(S * pdf * sigma) / (2 * sqrtT) + RISK_FREE * leg.strike * df * normCdf(-d2)) / 365;
  }

  const dir = leg.side === 'buy' ? 1 : -1;
  return { delta: delta * dir, gamma: gamma * dir, theta: theta * dir, vega: vega * dir };
}

// ==================== 组合计算 ====================

/** 到期时单份组合内在收益 (未扣权利金) */
function intrinsicPayoff(legs: OptionLeg[], price: number): number {
  return legs.reduce((sum, leg) => {
    const value =
      leg.type === 'call'
        ? Math.max(price - leg.strike, 0)
        : Math.max(leg.strike - price, 0);
    return sum + (leg.side === 'buy' ? value : -value);
  }, 0);
}

/** 计算组合全部指标 */
export function computePosition(input: PositionInput): PositionMetrics {
  const { underlyingPrice: S, legs, contracts, pointValue, daysToExpiry } = input;
  const iv = input.iv ?? DEFAULT_IV;
  const multiplier = contracts * pointValue;

  // 每股净权利金(买入支付 - 卖出收入)
  const debitPerShare = legs.reduce(
    (sum, leg) => sum + (leg.side === 'buy' ? leg.premium : -leg.premium),
    0
  );
  const netDebit = debitPerShare * multiplier;

  // 结构识别
  const buyCall = legs.find((l) => l.side === 'buy' && l.type === 'call');
  const buyPut = legs.find((l) => l.side === 'buy' && l.type === 'put');
  const hasSell = legs.some((l) => l.side === 'sell');
  let structure: PositionMetrics['structure'] = 'custom';
  if (buyCall && buyPut && legs.length === 2) {
    structure =
      Math.abs(buyCall.strike - buyPut.strike) < 1e-9 ? 'straddle' : 'strangle';
  }

  // ---- 损益曲线采样 (数值法, 兼容含卖出腿的组合) ----
  const strikes = legs.map((l) => l.strike);
  const minK = Math.min(...strikes, S);
  const maxK = Math.max(...strikes, S);
  const center = (minK + maxK) / 2;
  const span = Math.max(maxK - minK, Math.abs(debitPerShare) * 2, center * 0.15);
  const chartLow = Math.max(0.0001, center - 2.4 * span);
  const chartHigh = center + 2.4 * span;

  const N = 96;
  const payoffCurve: PayoffPoint[] = [];
  for (let i = 0; i <= N; i++) {
    const price = chartLow + ((chartHigh - chartLow) * i) / N;
    const pnl = (intrinsicPayoff(legs, price) - debitPerShare) * multiplier;
    payoffCurve.push({ price, pnl });
  }

  // ---- 平衡点: 精细扫描零轴穿越 ----
  // 多头跨式/宽跨: 曲线两端盈利、中间亏损 → 先"由盈转亏"(下平衡点) 后"由亏转盈"(上平衡点)
  // 若权利金高于PUT行权价, 下方可能不存在平衡点(仅一次向上穿越)
  const scanLow = Math.max(0.0001, minK * 0.2);
  const scanHigh = maxK * 2.2 + Math.abs(debitPerShare) * 2;
  const M = 2400;
  let lowerBE: number | null = null;
  let upperBE: number | null = null;
  let prevPrice = scanLow;
  let prevPnl = intrinsicPayoff(legs, scanLow) - debitPerShare;
  for (let i = 1; i <= M && upperBE === null; i++) {
    const price = scanLow + ((scanHigh - scanLow) * i) / M;
    const pnl = intrinsicPayoff(legs, price) - debitPerShare;
    if (prevPnl >= 0 && pnl < 0) {
      // 由盈转亏 → 下平衡点
      const t = prevPnl / (prevPnl - pnl);
      if (lowerBE === null) lowerBE = prevPrice + (price - prevPrice) * t;
    } else if (prevPnl < 0 && pnl >= 0) {
      // 由亏转盈 → 上平衡点
      const t = prevPnl / (prevPnl - pnl);
      upperBE = prevPrice + (price - prevPrice) * t;
    }
    prevPrice = price;
    prevPnl = pnl;
  }

  // ---- 最大亏损 / 最大收益 ----
  let minPnl = Infinity;
  let maxPnl = -Infinity;
  for (const p of payoffCurve) {
    if (p.pnl < minPnl) minPnl = p.pnl;
    if (p.pnl > maxPnl) maxPnl = p.pnl;
  }
  // 端点外推 (曲线范围之外的极限)
  const leftEdge = (intrinsicPayoff(legs, 0.0001) - debitPerShare) * multiplier;
  const rightEdge = (intrinsicPayoff(legs, scanHigh * 3) - debitPerShare) * multiplier;
  minPnl = Math.min(minPnl, leftEdge, rightEdge);
  maxPnl = Math.max(maxPnl, leftEdge, rightEdge);

  const maxLoss = Math.max(-minPnl, 0);
  const profitCapped = hasSell;
  const maxProfit = profitCapped ? maxPnl : Infinity;

  // ---- 希腊字母 ----
  const g = legs.reduce(
    (acc, leg) => {
      const lg = legGreeks(leg, S, daysToExpiry, iv);
      acc.delta += lg.delta;
      acc.gamma += lg.gamma;
      acc.theta += lg.theta;
      acc.vega += lg.vega;
      return acc;
    },
    { delta: 0, gamma: 0, theta: 0, vega: 0 }
  );

  return {
    structure,
    debitPerShare,
    netDebit,
    maxLoss,
    maxProfit,
    profitCapped,
    lowerBreakeven: lowerBE,
    upperBreakeven: upperBE,
    intervalWidth:
      lowerBE !== null && upperBE !== null ? upperBE - lowerBE : null,
    greeks: {
      delta: g.delta,
      gamma: g.gamma,
      thetaPerDay: g.theta,
      vegaPer1Pct: g.vega,
      positionTheta: g.theta * multiplier,
      positionVega: g.vega * multiplier,
    },
    payoffCurve,
  };
}

// ==================== 调仓方案生成 ====================

export interface PlanContext {
  underlyingPrice: number;
  callStrike: number;
  putStrike: number;
  callPremium: number;
  putPremium: number;
  strikes: number[]; // 可用行权价档位(升序)
  contracts: number;
  pointValue: number;
  daysToExpiry: number;
  /** 从链上查权利金, 查不到返回 null (将用 BS 估算) */
  lookupPremium: (strike: number, type: 'call' | 'put') => number | null;
}

function nearestStrike(strikes: number[], target: number): number {
  return strikes.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
}

function stepStrike(strikes: number[], current: number, direction: -1 | 1): number {
  const idx = strikes.findIndex((s) => Math.abs(s - current) < 1e-9);
  if (idx < 0) return nearestStrike(strikes, current + direction * 0.001);
  const next = idx + direction;
  return strikes[Math.min(Math.max(next, 0), strikes.length - 1)];
}

/** 生成 4 种收窄盈亏平衡点的备选方案 (对应需求文档方案1~4) */
export function generateAdjustmentPlans(ctx: PlanContext): AdjustmentPlan[] {
  const {
    underlyingPrice: S,
    callStrike,
    putStrike,
    callPremium,
    putPremium,
    strikes,
    contracts,
    pointValue,
    daysToExpiry,
    lookupPremium,
  } = ctx;

  // 用当前两腿价格反推 IV, 用于缺失价格的 BS 估算
  const ivC = impliedVol('call', callPremium, S, callStrike, daysToExpiry);
  const ivP = impliedVol('put', putPremium, S, putStrike, daysToExpiry);
  const iv = ivC ?? ivP ?? DEFAULT_IV;

  const price = (strike: number, type: 'call' | 'put'): number => {
    const fromChain = lookupPremium(strike, type);
    if (fromChain !== null && fromChain > 0) return fromChain;
    return Math.round(bsPrice(type, S, strike, daysToExpiry, iv) * 10000) / 10000;
  };

  const base = { contracts, pointValue, daysToExpiry, iv, underlyingPrice: S };

  const plans: AdjustmentPlan[] = [];

  // 方案1: 转平值跨式 (行权价差→0, 收窄效果最强)
  const atm = nearestStrike(strikes, S);
  const legs1: OptionLeg[] = [
    { side: 'buy', type: 'call', strike: atm, premium: price(atm, 'call') },
    { side: 'buy', type: 'put', strike: atm, premium: price(atm, 'put') },
  ];
  plans.push({
    id: 'atm-straddle',
    title: '① 转平值跨式',
    description: `CALL/PUT 同移到最接近现价的 ${atm} 行权价, 行权价差归零`,
    note: '收窄幅度最大, 小幅波动即盈利; 但平值权利金更贵, 最大亏损上升',
    applicable: true,
    legs: legs1,
    metrics: computePosition({ ...base, legs: legs1 }),
  });

  // 方案2: 缩小行权价差 (各向内靠一档, 保留宽跨)
  const callIn = stepStrike(strikes, callStrike, -1);
  const putIn = stepStrike(strikes, putStrike, 1);
  const legs2: OptionLeg[] = [
    { side: 'buy', type: 'call', strike: callIn, premium: price(callIn, 'call') },
    { side: 'buy', type: 'put', strike: putIn, premium: price(putIn, 'put') },
  ];
  plans.push({
    id: 'narrow-gap',
    title: '② 缩小行权价差',
    description: `CALL ${callStrike}→${callIn}, PUT ${putStrike}→${putIn}, 各向内靠一档`,
    note: '保留宽跨结构, 行权越靠近平值 Vega 越高; 权利金小幅上升',
    applicable: callIn !== callStrike || putIn !== putStrike,
    legs: legs2,
    metrics: computePosition({ ...base, legs: legs2 }),
  });

  // 方案3: 降低权利金 (各向外移一档, 更深虚值)
  const callOut = stepStrike(strikes, callStrike, 1);
  const putOut = stepStrike(strikes, putStrike, -1);
  const legs3: OptionLeg[] = [
    { side: 'buy', type: 'call', strike: callOut, premium: price(callOut, 'call') },
    { side: 'buy', type: 'put', strike: putOut, premium: price(putOut, 'put') },
  ];
  plans.push({
    id: 'cheaper',
    title: '③ 更深虚值降成本',
    description: `CALL ${callStrike}→${callOut}, PUT ${putStrike}→${putOut}, 权利金更便宜`,
    note: '净支出与最大亏损降低; 但平衡点未必收窄, 需更大波动才盈利',
    applicable: callOut !== callStrike || putOut !== putStrike,
    legs: legs3,
    metrics: computePosition({ ...base, legs: legs3 }),
  });

  // 方案4: 卖外侧收权利金 (保留原组合 + 卖出更低PUT/更高CALL)
  const sellPutK = stepStrike(strikes, putStrike, -1);
  const sellCallK = stepStrike(strikes, callStrike, 1);
  const legs4: OptionLeg[] = [
    { side: 'buy', type: 'call', strike: callStrike, premium: callPremium },
    { side: 'buy', type: 'put', strike: putStrike, premium: putPremium },
    { side: 'sell', type: 'put', strike: sellPutK, premium: price(sellPutK, 'put') },
    { side: 'sell', type: 'call', strike: sellCallK, premium: price(sellCallK, 'call') },
  ];
  plans.push({
    id: 'sell-wings',
    title: '④ 卖外侧收权利金',
    description: `保留 ${callStrike}C+${putStrike}P, 加卖 ${sellPutK}P + ${sellCallK}C 收权利金`,
    note: '净支出大降, 平衡点显著收窄; 代价是两端收益封顶, 不再无限盈利',
    applicable: false, // 四腿结构, 仅展示不下单
    legs: legs4,
    metrics: computePosition({ ...base, legs: legs4 }),
  });

  return plans;
}

// ==================== 到期日工具 ====================

/** 由到期月份(YYYYMM)估算剩余天数 (上交所ETF期权: 到期月第4个周三) */
export function daysToExpiryMonth(expiryYYYYMM: string): number {
  if (expiryYYYYMM.length < 6) return 30;
  const year = parseInt(expiryYYYYMM.slice(0, 4), 10);
  const month = parseInt(expiryYYYYMM.slice(4, 6), 10);
  if (Number.isNaN(year) || Number.isNaN(month)) return 30;

  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=周日
  const firstWed = 1 + ((3 - firstDay + 7) % 7);
  const fourthWed = new Date(year, month - 1, firstWed + 21);
  const diff = Math.ceil((fourthWed.getTime() - Date.now()) / 86400000);
  return Math.max(diff, 1);
}

/** 链不可用时生成未来 4 个到期月份 (YYYYMM) */
export function fallbackExpiryMonths(): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = 0; i < 4; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    result.push(
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
    );
  }
  return result;
}

/** 链不可用时按标的价格生成 9 档合成行权价 (间距约2.5%) */
export function fallbackStrikes(underlyingPrice: number): number[] {
  const step = Math.max(underlyingPrice * 0.025, 0.05);
  const rounded = Math.round(step * 20) / 20; // 步长取整到 0.05
  const center = Math.round(underlyingPrice / rounded) * rounded;
  const strikes: number[] = [];
  for (let i = -4; i <= 4; i++) {
    strikes.push(Math.round((center + i * rounded) * 1000) / 1000);
  }
  return strikes;
}

// ==================== 自检 (需求文档案例) ====================

/** 案例: 11C + 19P, 每股成本 15.06 → 平衡点应为 3.94 / 26.06 */
export function straddleSelfTest(): boolean {
  const m = computePosition({
    underlyingPrice: 15,
    legs: [
      { side: 'buy', type: 'call', strike: 11, premium: 7.53 },
      { side: 'buy', type: 'put', strike: 19, premium: 7.53 },
    ],
    contracts: 1,
    pointValue: 100,
    daysToExpiry: 200,
  });
  const ok =
    m.lowerBreakeven !== null &&
    m.upperBreakeven !== null &&
    Math.abs(m.lowerBreakeven - 3.94) < 0.05 &&
    Math.abs(m.upperBreakeven - 26.06) < 0.05 &&
    Math.abs(m.netDebit - 1506) < 1;
  if (!ok) {
    console.warn('[straddleEngine] self-test failed', m.lowerBreakeven, m.upperBreakeven, m.netDebit);
  }
  return ok;
}
