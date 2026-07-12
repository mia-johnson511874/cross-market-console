// 期权定价与模拟引擎

import type { Greeks, OptionProduct } from '../data/optionProducts';

export interface OptionState {
  index: number;
  strike: number;
  nearCallPremium: number;
  nearPutPremium: number;
  farCallCost: number;
  farPutCost: number;
  daysToNear: number;
  daysToFar: number;
  realizedPnl: number;
  trades: number;
  greeks: Greeks;
  pointValue: number;
}

/**
 * 初始化期权状态
 * 文档 3.2.4
 */
export function initOptionState(product: OptionProduct): OptionState {
  return {
    index: product.price,
    strike: product.strike,
    nearCallPremium: product.nearCall,
    nearPutPremium: product.nearPut,
    farCallCost: product.farCall,
    farPutCost: product.farPut,
    daysToNear: product.daysNear,
    daysToFar: product.daysFar,
    realizedPnl: 0,
    trades: 0,
    greeks: { ...product.greeks },
    pointValue: product.pointValue,
  };
}

/**
 * 模拟标的价格变动
 * 文档 3.2.5
 * @param direction -1 大跌 / +1 大涨
 */
export function simulateOptionMove(
  direction: -1 | 1,
  state: OptionState,
  product: OptionProduct
): OptionState {
  const moveRatio = 0.03; // 模拟3%涨跌幅
  const move =
    direction > 0 ? state.strike * moveRatio : -state.strike * moveRatio;
  const newState: OptionState = {
    ...state,
    index: state.index + move,
    trades: state.trades + 1,
    greeks: { ...state.greeks },
  };

  // 内在价值
  const callIntrinsic = Math.max(newState.index - newState.strike, 0);
  const putIntrinsic = Math.max(newState.strike - newState.index, 0);
  const totalIntrinsic = callIntrinsic + putIntrinsic;

  // 时间价值 (简化模型: 平值最大, 偏离衰减)
  const atmTimeValue = product.price > 100 ? 150 : 0.15;
  const deviation = Math.abs(newState.index - newState.strike);
  const timeValue = atmTimeValue * Math.exp(-Math.pow(deviation / atmTimeValue, 2));

  // 远月跨式价值 (内在价值 + 时间价值) x 合约乘数
  const farValue = (totalIntrinsic + timeValue) * newState.pointValue;

  // 近月跨式盈亏 (收入 - 内在价值 x 合约乘数)
  const nearPremium =
    (newState.nearCallPremium + newState.nearPutPremium) * newState.pointValue;
  const nearPayoff = nearPremium - totalIntrinsic * newState.pointValue;

  // 远月跨式盈亏 (价值 - 成本)
  const farCost =
    (newState.farCallCost + newState.farPutCost) * newState.pointValue;
  const farPayoff = farValue - farCost;

  newState.realizedPnl = Math.round((nearPayoff + farPayoff) * 100) / 100;

  // 更新希腊字母 (简化)
  newState.greeks.delta =
    Math.round(deviation * 0.05 * 10000) / 10000;
  newState.greeks.gamma =
    Math.round((-12.5 - Math.abs(deviation) * 0.02) * 100) / 100;
  newState.greeks.theta =
    Math.round(newState.greeks.theta * (1 + moveRatio * 0.5) * 100) / 100;
  newState.greeks.vega =
    Math.round(newState.greeks.vega * (1 - moveRatio * 0.3) * 100) / 100;

  return newState;
}

/**
 * 模拟时间流逝 (1天)
 * 文档 3.2.6
 */
export function simulateTimeDecay(state: OptionState): OptionState {
  const newState: OptionState = {
    ...state,
    daysToNear: state.daysToNear - 1,
    daysToFar: state.daysToFar - 1,
    trades: state.trades + 1,
    greeks: { ...state.greeks },
  };

  // Theta收益
  newState.realizedPnl =
    Math.round((newState.realizedPnl + newState.greeks.theta) * 100) / 100;

  // 权利金衰减 (近月每日衰减8%, 远月每日衰减2%)
  newState.nearCallPremium =
    Math.round(newState.nearCallPremium * 0.92 * 10000) / 10000;
  newState.nearPutPremium =
    Math.round(newState.nearPutPremium * 0.92 * 10000) / 10000;
  newState.farCallCost =
    Math.round(newState.farCallCost * 0.98 * 10000) / 10000;
  newState.farPutCost =
    Math.round(newState.farPutCost * 0.98 * 10000) / 10000;

  return newState;
}

/**
 * 获取市场状态判断
 * 文档 3.4.2
 */
export function getMarketStatus(optionState: OptionState): string {
  const diff = Math.abs(optionState.index - optionState.strike);
  const range = optionState.strike * 0.05; // 5%区间定义为震荡

  if (diff > range * 2) return '单边';
  if (diff > range) return '偏震荡';
  return '震荡';
}

/**
 * 计算总盈亏 (左侧网格 + 右侧期权)
 * 文档 3.4.3
 */
export function getTotalPnl(
  gridPnl: number,
  optionPnl: number,
  optionCurrency: string
): number {
  const fxRate = optionCurrency === 'HKD' ? 0.92 : 1;
  return Math.round((gridPnl + optionPnl * fxRate) * 100) / 100;
}
