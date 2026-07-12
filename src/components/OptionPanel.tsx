// 右侧: 双日历价差面板

import type { OptionProduct } from '../data/optionProducts';
import { optionProducts, marketTypeLabels } from '../data/optionProducts';
import type { OptionState } from '../utils/optionEngine';
import { getMarketStatus } from '../utils/optionEngine';

interface OptionPanelProps {
  selectedProduct: OptionProduct;
  onSelectProduct: (p: OptionProduct) => void;
  state: OptionState;
  legs: {
    label: string;
    type: 'sell' | 'buy';
    strike: number;
    premium: number;
    color: string;
  }[];
  onMoveDown: () => void;
  onMoveUp: () => void;
  onTimePass: () => void;
  onReset: () => void;
  pairedGridName?: string;
  livePrice?: number | null;
  liveChangePct?: number | null;
  isOnline?: boolean;
}

// 按市场类型分组
const groupedOptions = optionProducts.reduce(
  (acc, p) => {
    const cat = marketTypeLabels[p.marketType];
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  },
  {} as Record<string, OptionProduct[]>
);

export default function OptionPanel({
  selectedProduct,
  onSelectProduct,
  state,
  legs,
  onMoveDown,
  onMoveUp,
  onTimePass,
  onReset,
  pairedGridName,
  livePrice,
  liveChangePct,
  isOnline,
}: OptionPanelProps) {
  const marketStatus = getMarketStatus(state);

  return (
    <div className="panel option-panel">
      <div className="panel-header option-header">
        <h2>📅 双日历价差</h2>
        <span className="badge badge-option">期权策略</span>
      </div>

      {/* 品种选择 */}
      <div className="form-group">
        <label>期权品种</label>
        <select
          value={selectedProduct.id}
          onChange={(e) => {
            const p = optionProducts.find((o) => o.id === e.target.value);
            if (p) onSelectProduct(p);
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

      {/* 实时行情指示器 */}
      {livePrice != null && (
        <div className="live-indicator">
          <span className="live-dot" />
          <span className="live-label">标的实时</span>
          <span className="live-price">
            ¥{livePrice.toFixed(3)}
          </span>
          {liveChangePct != null && (
            <span className={`live-change ${liveChangePct >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
              {liveChangePct >= 0 ? '+' : ''}{liveChangePct.toFixed(2)}%
            </span>
          )}
        </div>
      )}
      {isOnline === false && (
        <div className="offline-banner">
          ⚠️ 离线模式 — 显示默认价格
        </div>
      )}

      {/* 当前状态 */}
      <div className="status-row">
        <div className="status-item">
          <span className="status-label">标的价格</span>
          <span className="status-value price-value">
            {selectedProduct.currency === 'HKD' ? 'HK$' : '¥'}
            {state.index.toFixed(selectedProduct.price > 100 ? 0 : 3)}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">组合盈亏</span>
          <span
            className={`status-value ${state.realizedPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}
          >
            {selectedProduct.currency === 'HKD' ? 'HK$' : '¥'}
            {state.realizedPnl.toFixed(2)}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">操作次数</span>
          <span className="status-value">{state.trades}</span>
        </div>
      </div>

      {/* 市场状态 */}
      <div className="market-status">
        <span>市场状态: </span>
        <span className={`market-tag market-${marketStatus}`}>
          {marketStatus}
        </span>
        <span className="market-info">
          行权价: {state.strike.toFixed(selectedProduct.price > 100 ? 0 : 2)}
        </span>
      </div>

      {/* 四腿结构 */}
      <div className="option-legs">
        <h4>四腿结构</h4>
        {legs.map((leg, i) => (
          <div key={i} className={`leg-row leg-${leg.color}`}>
            <span className={`leg-tag tag-${leg.color}`}>
              {leg.type === 'sell' ? '卖出' : '买入'}
            </span>
            <span className="leg-name">{leg.label}</span>
            <span className="leg-strike">
              行权价: {leg.strike.toFixed(selectedProduct.price > 100 ? 0 : 2)}
            </span>
            <span className="leg-premium">
              {leg.type === 'sell' ? '+' : '-'}
              {leg.premium.toFixed(selectedProduct.price > 100 ? 2 : 4)} pts
            </span>
          </div>
        ))}
      </div>

      {/* 时间信息 */}
      <div className="time-info">
        <div className="time-row">
          <span>近月剩余: <strong>{state.daysToNear}</strong> 天</span>
          <span>远月剩余: <strong>{state.daysToFar}</strong> 天</span>
        </div>
        {selectedProduct.contractUnit && (
          <div className="contract-info">
            合约单位: {selectedProduct.contractUnit}
            {selectedProduct.exerciseType && (
              <span> | 行权方式: {selectedProduct.exerciseType === 'european' ? '欧式' : '美式'}</span>
            )}
          </div>
        )}
      </div>

      {/* 希腊字母 */}
      <div className="greeks">
        <h4>希腊字母</h4>
        <div className="greeks-grid">
          <div className="greek-item">
            <span className="greek-label">Δ Delta</span>
            <span className={`greek-value ${state.greeks.delta >= 0 ? 'positive' : 'negative'}`}>
              {state.greeks.delta.toFixed(4)}
            </span>
          </div>
          <div className="greek-item">
            <span className="greek-label">Γ Gamma</span>
            <span className="greek-value">
              {state.greeks.gamma.toFixed(2)}
            </span>
          </div>
          <div className="greek-item">
            <span className="greek-label">Θ Theta</span>
            <span className="greek-value positive">
              +{state.greeks.theta.toFixed(2)}
            </span>
          </div>
          <div className="greek-item">
            <span className="greek-label">Ν Vega</span>
            <span className="greek-value">
              {state.greeks.vega.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* 跨品种配对提示 */}
      {pairedGridName && (
        <div className="pair-notice">
          🔗 可配对网格品种: <strong>{pairedGridName}</strong>
        </div>
      )}

      {/* 模拟操作 */}
      <div className="action-buttons">
        <button className="btn btn-buy" onClick={onMoveDown}>
          📉 标的大跌 (-3%)
        </button>
        <button className="btn btn-sell" onClick={onMoveUp}>
          📈 标的大涨 (+3%)
        </button>
        <button className="btn btn-time" onClick={onTimePass}>
          ⏱ 时间流逝 (1天)
        </button>
        <button className="btn btn-reset" onClick={onReset}>
          🔄 重置
        </button>
      </div>
    </div>
  );
}
