// 双日历价差(Double Calendar)专家建议引擎
// 结构: 卖出近月平值跨式(收权利金) + 买入远月平值跨式(付权利金)
// 目标: 权利金最小(净支出最低/净收入最高) / 到期(近月到期时)预期收益最大 / 综合最优
// 复用 straddleEngine 的 Black-Scholes 定价与 IV 反推

import { bsPrice, impliedVol, expectedMovePct } from './straddleEngine';

export interface CalendarCandidate {
  id: string;
  title: string;
  strike: number;
  daysNear: number;
  daysFar: number;
  nearCall: number;
  nearPut: number;
  farCall: number;
  farPut: number;
  netPremium: number; // 每股净权利金 = 近月收入 - 远月成本 (>0净收入, <0净支出)
  netPremiumTotal: number; // 总净权利金(元)
  maxLoss: number; // 估算最大亏损(元)
  projectedProfit: number; // 近月到期时1σ预期收益(元)
  rewardRisk: number; // 预期收益 / 最大亏损
  note: string;
}

export interface CalendarExpertAdvice {
  iv: number;
  expectedMovePct: number; // 近月1σ预期波动(%)
  bestPremium: CalendarCandidate; // 权利金最小(净支出最低)
  bestProfit: CalendarCandidate; // 到期预期收益最大
  bestOverall: CalendarCandidate; // 综合最优(专家推荐)
  reasoning: string;
  candidates: CalendarCandidate[];
}

export interface CalendarAdviceInput {
  underlyingPrice: number;
  baseStrike: number;
  daysNear: number;
  daysFar: number;
  contracts: number;
  pointValue: number;
  /** 当前近月权利金(用于反推IV) */
  nearCallPremium: number;
  nearPutPremium: number;
  farCallCost: number;
  farPutCost: number;
}

const DEFAULT_IV = 0.25;

/** 标准正态概率密度(局部实现, 用于近月到期损益加权) */
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** 围绕标的价格生成 9 档行权价 (间距约2.5%) */
function strikeLadder(S: number): number[] {
  const step = Math.max(S * 0.025, 0.05);
  const rounded = Math.round(step * 20) / 20;
  const center = Math.round(S / rounded) * rounded;
  const out: number[] = [];
  for (let i = -4; i <= 4; i++) {
    out.push(Math.round((center + i * rounded) * 1000) / 1000);
  }
  return out;
}

function nearestStrike(strikes: number[], target: number): number {
  return strikes.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
}

/** 单个双日历候选的指标计算 */
function evaluate(
  S: number,
  K: number,
  daysNear: number,
  daysFar: number,
  iv: number,
  contracts: number,
  pointValue: number
): Pick<CalendarCandidate, 'nearCall' | 'nearPut' | 'farCall' | 'farPut' | 'netPremium' | 'netPremiumTotal' | 'maxLoss' | 'projectedProfit' | 'rewardRisk'> {
  const dNear = Math.max(daysNear, 1);
  const dFar = Math.max(daysFar, dNear + 1);

  const nearCall = bsPrice('call', S, K, dNear, iv);
  const nearPut = bsPrice('put', S, K, dNear, iv);
  const farCall = bsPrice('call', S, K, dFar, iv);
  const farPut = bsPrice('put', S, K, dFar, iv);

  const netPremium = nearCall + nearPut - farCall - farPut; // 每股
  const multiplier = contracts * pointValue;
  const netPremiumTotal = netPremium * multiplier;

  // 近月到期时损益模拟: 标的在 1σ(近月) 范围内扫描
  const sigma = S * (expectedMovePct(iv, dNear) / 100);
  const dRem = dFar - dNear; // 近月到期后远月剩余天数
  const N = 41;
  let expProfit = 0;
  let weightSum = 0;
  let worstPnl = Infinity;
  for (let i = 0; i < N; i++) {
    const z = -3 + (6 * i) / (N - 1); // -3σ ~ +3σ
    const sEnd = Math.max(S + z * sigma, 0.0001);
    // 近月跨式(卖出)结算: 收入 - 内在价值
    const nearIntrinsic = Math.abs(sEnd - K);
    const nearPnl = nearCall + nearPut - nearIntrinsic;
    // 远月跨式(买入)在近月到期时的价值
    const farVal = bsPrice('call', sEnd, K, dRem, iv) + bsPrice('put', sEnd, K, dRem, iv);
    const farPnl = farVal - farCall - farPut;
    const totalPerShare = nearPnl + farPnl;
    const w = normPdf(z);
    expProfit += totalPerShare * w;
    weightSum += w;
    if (totalPerShare < worstPnl) worstPnl = totalPerShare;
  }
  expProfit = (expProfit / weightSum) * multiplier;

  // 最大亏损估算: 取扫描区间最差值与净支出(封顶)的较大者
  const maxLoss = Math.max(-worstPnl * multiplier, Math.abs(netPremiumTotal));

  const rewardRisk = maxLoss > 1e-9 ? expProfit / maxLoss : expProfit > 0 ? 999 : 0;

  return {
    nearCall: Math.round(nearCall * 10000) / 10000,
    nearPut: Math.round(nearPut * 10000) / 10000,
    farCall: Math.round(farCall * 10000) / 10000,
    farPut: Math.round(farPut * 10000) / 10000,
    netPremium,
    netPremiumTotal: Math.round(netPremiumTotal * 100) / 100,
    maxLoss: Math.round(maxLoss * 100) / 100,
    projectedProfit: Math.round(expProfit * 100) / 100,
    rewardRisk: Math.round(rewardRisk * 1000) / 1000,
  };
}

export function generateCalendarExpertAdvice(input: CalendarAdviceInput): CalendarExpertAdvice {
  const {
    underlyingPrice: S,
    baseStrike,
    daysNear,
    daysFar,
    contracts,
    pointValue,
    nearCallPremium,
    nearPutPremium,
    farCallCost,
  } = input;

  // 由当前近月权利金反推 IV
  const ivC = impliedVol('call', nearCallPremium, S, baseStrike, daysNear);
  const ivP = impliedVol('put', nearPutPremium, S, baseStrike, daysNear);
  const ivF = impliedVol('call', farCallCost, S, baseStrike, daysFar);
  const iv = ivC ?? ivP ?? ivF ?? DEFAULT_IV;

  const ladder = strikeLadder(S);
  const atm = nearestStrike(ladder, S);
  const atmIdx = ladder.findIndex((s) => Math.abs(s - atm) < 1e-9);

  const candidates: CalendarCandidate[] = [];
  const mk = (
    id: string,
    title: string,
    K: number,
    dNear: number,
    dFar: number,
    note: string
  ): CalendarCandidate => {
    const ev = evaluate(S, K, dNear, dFar, iv, contracts, pointValue);
    return {
      id,
      title,
      strike: K,
      daysNear: dNear,
      daysFar: dFar,
      ...ev,
      note,
    };
  };

  // ---- 候选1组: 固定当前时间结构, 扫描行权价(平值/±1/±2档) ----
  const timeNote = `近${daysNear}天/远${daysFar}天`;
  for (let off = -2; off <= 2; off++) {
    const idx = Math.min(Math.max(atmIdx + off, 0), ladder.length - 1);
    const K = ladder[idx];
    if (off === 0) {
      candidates.push(mk(`cal-atm`, '平值双日历', K, daysNear, daysFar, `平值行权, Theta衰减最充分; ${timeNote}`));
    } else {
      const dir = off > 0 ? '上方' : '下方';
      candidates.push(mk(`cal-otm-${off}`, `${dir}偏移${Math.abs(off)}档`, K, daysNear, daysFar, `行权价偏离平值${Math.abs(off)}档, 净支出降低但方向敞口增大; ${timeNote}`));
    }
  }

  // ---- 候选2组: 固定平值行权价, 扫描时间结构 ----
  const timeCombos: Array<[number, number, string]> = [
    [7, 30, '近月7天/远月30天: 近月Theta最快, 时间价差最陡'],
    [14, 45, '近月14天/远月45天: 经典双日历节奏'],
    [21, 60, '近月21天/远月60天: 时间价差更平缓, 权利金更高'],
    [10, 35, '近月10天/远月35天: 兼顾衰减与展期空间'],
  ];
  for (const [dn, df, note] of timeCombos) {
    candidates.push(mk(`cal-time-${dn}-${df}`, `时间结构 ${dn}/${df}天`, atm, dn, df, note));
  }

  // 权利金最小 = 净支出最低(netPremium 最小绝对值/最大净收入)
  const bestPremium = candidates.reduce((a, b) =>
    b.netPremium > a.netPremium ? b : a
  );
  // 到期预期收益最大
  const bestProfit = candidates.reduce((a, b) =>
    b.projectedProfit > a.projectedProfit ? b : a
  );
  // 综合最优 = 风险收益比最高
  candidates.sort((a, b) => b.rewardRisk - a.rewardRisk);
  const bestOverall = candidates[0];

  const reasoning =
    `基于 IV≈${(iv * 100).toFixed(1)}%、近月剩余 ${daysNear} 天, 标的 1σ 预期波动约 ±${expectedMovePct(iv, daysNear).toFixed(1)}%。` +
    `权利金最小(净支出最低)为「${bestPremium.title}」(净支出¥${Math.abs(bestPremium.netPremiumTotal).toFixed(0)}); ` +
    `近月到期预期收益最大为「${bestProfit.title}」(¥${bestProfit.projectedProfit.toFixed(0)}); ` +
    `综合风险收益比最优(专家推荐)为「${bestOverall.title}」, 风险收益比 ${bestOverall.rewardRisk.toFixed(2)}。`;

  return {
    iv,
    expectedMovePct: expectedMovePct(iv, daysNear),
    bestPremium,
    bestProfit,
    bestOverall,
    reasoning,
    candidates,
  };
}