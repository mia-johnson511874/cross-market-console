// 左侧: 网格交易面板

import type { GridProduct } from '../data/gridProducts';
import { gridProducts, categoryLabels } from '../data/gridProducts';
import { getGridLines } from '../utils/gridEngine';
import type { GridState } from '../utils/gridEngine';

interface GridPanelProps {
  selectedProduct: GridProduct;
  onSelectProduct: (p: GridProduct) => void;
  state: GridState;
  currentPrice: number;
  capitalRatio: number;
  error: string | null;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onReset: () => void;
  pairedOptionName?: string;
  livePrice?: number | null;
  liveChangePct?: number | null;
  isOnline?: boolean;
}

// 按类别分组
const groupedProducts = gridProducts.reduce(
  (acc, p) => {
    const cat = categoryLabels[p.category];
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  },
  {} as Record<string, GridProduct[]>
);

export default function GridPanel({
  selectedProduct,
  onSelectProduct,
  state,
  currentPrice,
  capitalRatio,
  error,
  onMoveDown,
  onMoveUp,
  onReset,
  pairedOptionName,
  livePrice,
  liveChangePct,
  isOnline,
}: GridPanelProps) {
  const gridLines = getGridLines(selectedProduct, state);

  return (
    <div className="panel grid-panel">
      <div className="panel-header grid-header">
        <h2>📊 网格交易</h2>
        <span className="badge badge-grid">A股T+0 ETF</span>
      </div>

      {/* 品种选择 */}
      <div className="form-group">
        <label>品种选择</label>
        <select
          value={selectedProduct.id}
          onChange={(e) => {
            const p = gridProducts.find((g) => g.id === e.target.value);
            if (p) onSelectProduct(p);
          }}
        >
          {Object.entries(groupedProducts).map(([cat, products]) => (
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
          <span className="live-label">实时行情</span>
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
          ⚠️ 离线模式 — 显示默认价格，后端 API 未连接
        </div>
      )}

      {/* 当前状态 */}
      <div className="status-row">
        <div className="status-item">
          <span className="status-label">当前价格</span>
          <span className="status-value price-value">
            ¥{currentPrice.toFixed(3)}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">已实现盈亏</span>
          <span
            className={`status-value ${state.realizedPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}
          >
            ¥{state.realizedPnl.toFixed(2)}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">成交次数</span>
          <span className="status-value">{state.trades}</span>
        </div>
      </div>

      {/* 持仓信息 */}
      <div className="position-info">
        <div className="position-row">
          <span>持仓份数: <strong>{state.position}</strong> 份</span>
          <span>每格: <strong>{selectedProduct.sharesPerGrid}</strong> 份</span>
        </div>
        <div className="capital-bar-container">
          <div className="capital-bar-label">
            <span>资金占用</span>
            <span>¥{state.capitalUsed.toFixed(0)} / ¥{selectedProduct.totalCapital.toLocaleString()}</span>
          </div>
          <div className="capital-bar">
            <div
              className="capital-bar-fill"
              style={{ width: `${Math.min(capitalRatio, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* 网格可视化 */}
      <div className="grid-lines">
        {gridLines.map((line) => (
          <div
            key={line.index}
            className={`grid-line ${line.status} ${line.type}`}
          >
            <span className={`grid-tag tag-${line.type}`}>{line.label}</span>
            <span className="grid-price">¥{line.price.toFixed(3)}</span>
            <span className={`grid-status status-${line.status}`}>
              {line.status === 'current'
                ? '◀ 当前'
                : line.status === 'triggered'
                  ? '✓ 已触发'
                  : '待触发'}
            </span>
          </div>
        ))}
      </div>

      {/* 跨品种配对提示 */}
      {pairedOptionName && (
        <div className="pair-notice">
          🔗 可配对期权: <strong>{pairedOptionName}</strong>
        </div>
      )}

      {/* 错误提示 */}
      {error && <div className="error-msg">⚠️ {error}</div>}

      {/* 模拟操作 */}
      <div className="action-buttons">
        <button className="btn btn-buy" onClick={onMoveDown}>
          📉 下跌一格 (买入)
        </button>
        <button className="btn btn-sell" onClick={onMoveUp}>
          📈 上涨一格 (卖出)
        </button>
        <button className="btn btn-reset" onClick={onReset}>
          🔄 重置
        </button>
      </div>
    </div>
  );
}
