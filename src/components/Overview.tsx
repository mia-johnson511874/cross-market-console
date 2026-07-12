// 组合概览组件 (底部)

import { getMarketStatus } from '../utils/optionEngine';
import type { OptionState } from '../utils/optionEngine';

interface OverviewProps {
  gridPnl: number;
  optionPnl: number;
  gridTrades: number;
  optionTrades: number;
  optionCurrency: string;
  optionState: OptionState;
  isPaired: boolean;
  isCrossProduct: boolean;
}

export default function Overview({
  gridPnl,
  optionPnl,
  gridTrades,
  optionTrades,
  optionCurrency,
  optionState,
  isPaired,
  isCrossProduct,
}: OverviewProps) {
  const fxRate = optionCurrency === 'HKD' ? 0.92 : 1;
  const totalPnl = gridPnl + optionPnl * fxRate;
  const totalTrades = gridTrades + optionTrades;
  const marketStatus = getMarketStatus(optionState);

  let pairStatus: string;
  if (isCrossProduct) {
    pairStatus = '跨品种协同';
  } else if (isPaired) {
    pairStatus = '同一标的';
  } else {
    pairStatus = '独立操作';
  }

  return (
    <div className="overview">
      <h3>📈 组合概览</h3>
      <div className="overview-grid">
        <div className="overview-item">
          <span className="ov-label">总盈亏</span>
          <span className={`ov-value ${totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
            ¥{totalPnl.toFixed(2)}
          </span>
        </div>
        <div className="overview-item">
          <span className="ov-label">网格盈亏</span>
          <span className={`ov-value ${gridPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
            ¥{gridPnl.toFixed(2)}
          </span>
        </div>
        <div className="overview-item">
          <span className="ov-label">期权盈亏</span>
          <span className={`ov-value ${optionPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
            {optionCurrency === 'HKD' ? 'HK$' : '¥'}
            {optionPnl.toFixed(2)}
          </span>
        </div>
        <div className="overview-item">
          <span className="ov-label">总成交次数</span>
          <span className="ov-value">{totalTrades}</span>
        </div>
        <div className="overview-item">
          <span className="ov-label">市场状态</span>
          <span className={`ov-value market-tag market-${marketStatus}`}>
            {marketStatus}
          </span>
        </div>
        <div className="overview-item">
          <span className="ov-label">配对状态</span>
          <span className={`ov-value pair-tag ${isCrossProduct ? 'pair-cross' : isPaired ? 'pair-same' : 'pair-none'}`}>
            {pairStatus}
          </span>
        </div>
        <div className="overview-item">
          <span className="ov-label">期权汇率</span>
          <span className="ov-value">
            {optionCurrency === 'HKD' ? `${fxRate} (HKD→CNY)` : '本位币'}
          </span>
        </div>
        {isCrossProduct && (
          <div className="overview-item warning-item">
            <span className="ov-label">⚠️ 基差风险</span>
            <span className="ov-value risk-medium">跨品种配对存在基差</span>
          </div>
        )}
      </div>
    </div>
  );
}
