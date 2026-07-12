// 跨品种配对提示组件

import type { CrossPairConfig } from '../data/crossPairs';
import type { GridProduct } from '../data/gridProducts';
import type { OptionProduct } from '../data/optionProducts';

interface CrossPairNoticeProps {
  pair: CrossPairConfig | null;
  gridProduct: GridProduct | null;
  optionProduct: OptionProduct | null;
}

const basisRiskLabels: Record<string, { text: string; className: string }> = {
  low: { text: '低', className: 'risk-low' },
  medium: { text: '中', className: 'risk-medium' },
  high: { text: '高', className: 'risk-high' },
};

export default function CrossPairNotice({
  pair,
  gridProduct,
  optionProduct,
}: CrossPairNoticeProps) {
  if (!pair || !gridProduct || !optionProduct) {
    // 独立操作模式
    if (gridProduct && optionProduct) {
      return (
        <div className="cross-pair-notice no-pair">
          <span className="pair-icon">⚡</span>
          <span>
            独立操作: 左侧{gridProduct.name}与右侧{optionProduct.name}无配对关系
          </span>
        </div>
      );
    }
    return null;
  }

  const gridIsCommodity =
    gridProduct.category === 'commodity' || gridProduct.category === 'commodity-lof';
  const optIsCommodity = optionProduct.marketType === 'commodity-option';
  const isCrossProduct = gridIsCommodity && optIsCommodity;

  const basisInfo = basisRiskLabels[pair.basisRisk];

  return (
    <div className={`cross-pair-notice ${isCrossProduct ? 'cross-product' : 'same-underlying'}`}>
      <div className="pair-title">
        <span className="pair-icon">{isCrossProduct ? '⚠️' : '🔗'}</span>
        <span>
          {isCrossProduct ? '跨品种协同配对' : '同标的配对'}
        </span>
      </div>
      <div className="pair-details">
        <div className="pair-product-line">
          左侧: <strong>{gridProduct.name}</strong> ({gridProduct.code})
          {gridProduct.pairedOption?.note && (
            <span className="pair-note"> — {gridProduct.pairedOption.note}</span>
          )}
        </div>
        <div className="pair-product-line">
          右侧: <strong>{optionProduct.name}</strong> ({optionProduct.code})
          {optionProduct.pairedGrid?.note && (
            <span className="pair-note"> — {optionProduct.pairedGrid.note}</span>
          )}
        </div>
        <div className="pair-metrics">
          <span className="metric">
            相关性: <strong>{pair.correlation.toFixed(2)}</strong>
          </span>
          <span className={`metric ${basisInfo.className}`}>
            基差风险: <strong>{basisInfo.text}</strong>
          </span>
          <span className="metric">
            对冲效率: <strong>{(pair.hedgeEfficiency * 100).toFixed(0)}%</strong>
          </span>
        </div>
        <div className="basis-desc">{pair.basisDescription}</div>
        {isCrossProduct && (
          <div className="basis-warning">
            ⚠️ 注意: ETF与期货之间存在基差和展期收益差异，非严格同一标的对冲
          </div>
        )}
      </div>
    </div>
  );
}
