// 网格交易引擎

import type { GridProduct } from '../data/gridProducts';

export interface GridState {
  currentIdx: number;
  position: number;
  realizedPnl: number;
  trades: number;
  capitalUsed: number;
}

/**
 * 初始化网格状态
 * 文档 3.1.4
 */
export function initGridState(product: GridProduct): GridState {
  const idx = product.grids.indexOf(product.price);
  const currentIdx = idx >= 0 ? idx : Math.floor(product.grids.length / 2);
  return {
    currentIdx,
    position: product.baseShares,
    realizedPnl: 0,
    trades: 0,
    capitalUsed: product.baseShares * product.price,
  };
}

/**
 * 模拟网格移动
 * 文档 3.1.5
 * @param direction -1 下跌(买入) / +1 上涨(卖出)
 */
export function simulateGridMove(
  direction: -1 | 1,
  state: GridState,
  product: GridProduct
): GridState {
  const newIdx = state.currentIdx + direction;
  if (newIdx < 0 || newIdx >= product.grids.length) {
    throw new Error('已触及网格边界');
  }

  const oldPrice = product.grids[state.currentIdx];
  const newPrice = product.grids[newIdx];
  const newState: GridState = {
    currentIdx: newIdx,
    position: state.position,
    realizedPnl: state.realizedPnl,
    trades: state.trades + 1,
    capitalUsed: state.capitalUsed,
  };

  if (direction === 1) {
    // 上涨: 卖出
    newState.position -= product.sharesPerGrid;
    newState.realizedPnl += (newPrice - oldPrice) * product.sharesPerGrid;
    newState.capitalUsed -= product.sharesPerGrid * newPrice;
  } else {
    // 下跌: 买入
    newState.position += product.sharesPerGrid;
    newState.realizedPnl += (oldPrice - newPrice) * product.sharesPerGrid;
    newState.capitalUsed += product.sharesPerGrid * newPrice;
  }

  return newState;
}

/**
 * 获取网格线类型
 * 文档 3.1.6
 */
export type GridLineType = 'buy' | 'sell' | 'base';

export interface GridLineInfo {
  price: number;
  index: number;
  type: GridLineType;
  status: 'triggered' | 'current' | 'pending';
  label: string;
}

export function getGridLines(
  product: GridProduct,
  state: GridState
): GridLineInfo[] {
  return product.grids.map((price, i) => {
    let type: GridLineType;
    if (price < product.price) type = 'buy';
    else if (price > product.price) type = 'sell';
    else type = 'base';

    let status: 'triggered' | 'current' | 'pending';
    if (i < state.currentIdx) status = 'triggered';
    else if (i === state.currentIdx) status = 'current';
    else status = 'pending';

    const label =
      type === 'base' ? '基准' : type === 'buy' ? '买入' : '卖出';

    return { price, index: i, type, status, label };
  });
}

/**
 * 计算持仓盈亏百分比
 */
export function getPositionPnl(
  state: GridState,
  product: GridProduct
): number {
  const currentPrice = product.grids[state.currentIdx];
  const avgCost = state.capitalUsed / Math.max(state.position, 1);
  return ((currentPrice - avgCost) / avgCost) * 100;
}
