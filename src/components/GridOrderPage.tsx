import { useState, useCallback } from 'react';
import type { GridProduct } from '../data/gridProducts';
import { gridProducts, categoryLabels } from '../data/gridProducts';
import { getGridLines } from '../utils/gridEngine';
import type { GridState } from '../utils/gridEngine';

interface GridOrderPageProps {
  onSubmit: (product: GridProduct, order: GridOrder) => void;
  onCancel: () => void;
  livePrice?: number | null;
}

export interface GridOrder {
  productId: string;
  gridCount: number;
  gridStep: number;
  sharesPerGrid: number;
  totalCapital: number;
  basePrice: number;
}

const groupedProducts = gridProducts.reduce(
  (acc, p) => {
    const cat = categoryLabels[p.category];
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  },
  {} as Record<string, GridProduct[]>
);

export default function GridOrderPage({ onSubmit, onCancel, livePrice }: GridOrderPageProps) {
  const [selectedProduct, setSelectedProduct] = useState<GridProduct>(gridProducts[0]);
  
  const [gridCount, setGridCount] = useState(8);
  const [gridStep, setGridStep] = useState(0.025);
  const [sharesPerGrid, setSharesPerGrid] = useState(5000);
  const [totalCapital, setTotalCapital] = useState(200000);
  
  const [basePrice, setBasePrice] = useState(selectedProduct.price);
  const [orderType, setOrderType] = useState<'auto' | 'manual'>('auto');
  const [confirmModal, setConfirmModal] = useState(false);

  const handleProductChange = useCallback((p: GridProduct) => {
    setSelectedProduct(p);
    setBasePrice(p.price);
  }, []);

  const handleLivePriceUse = useCallback(() => {
    if (livePrice) {
      setBasePrice(livePrice);
      setOrderType('manual');
    }
  }, [livePrice]);

  const computedGrids = () => {
    const grids: number[] = [];
    const halfCount = Math.floor(gridCount / 2);
    for (let i = -halfCount; i <= halfCount; i++) {
      grids.push(Number((basePrice + i * gridStep).toFixed(4)));
    }
    return grids;
  };

  const estimatedInitialPosition = () => {
    const baseIdx = Math.floor(gridCount / 2);
    const baseShares = Math.floor(totalCapital / (basePrice * gridCount));
    return baseShares * (gridCount - baseIdx);
  };

  const grids = computedGrids();
  const tempState: GridState = {
    currentIdx: Math.floor(gridCount / 2),
    position: estimatedInitialPosition(),
    realizedPnl: 0,
    trades: 0,
    capitalUsed: estimatedInitialPosition() * basePrice,
  };
  const gridLines = getGridLines({ ...selectedProduct, grids }, tempState);

  const handleSubmit = () => {
    setConfirmModal(true);
  };

  const confirmOrder = () => {
    const order: GridOrder = {
      productId: selectedProduct.id,
      gridCount,
      gridStep,
      sharesPerGrid,
      totalCapital,
      basePrice,
    };
    onSubmit(selectedProduct, order);
    setConfirmModal(false);
  };

  return (
    <div className="order-page">
      <div className="order-header">
        <h2>📊 网格交易下单</h2>
        <button className="btn btn-cancel" onClick={onCancel}>
          ← 返回
        </button>
      </div>

      <div className="order-content">
        <div className="order-section">
          <h3>基本信息</h3>
          
          <div className="form-row">
            <div className="form-group">
              <label>品种选择</label>
              <select
                value={selectedProduct.id}
                onChange={(e) => {
                  const p = gridProducts.find((g) => g.id === e.target.value);
                  if (p) handleProductChange(p);
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
            
            <div className="form-group">
              <label>下单类型</label>
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    checked={orderType === 'auto'}
                    onChange={() => setOrderType('auto')}
                  />
                  自动基准价 (品种默认)
                </label>
                <label>
                  <input
                    type="radio"
                    checked={orderType === 'manual'}
                    onChange={() => setOrderType('manual')}
                  />
                  手动基准价
                </label>
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>基准价格</label>
              <div className="input-group">
                <span className="input-prefix">¥</span>
                <input
                  type="number"
                  value={basePrice.toFixed(3)}
                  onChange={(e) => setBasePrice(parseFloat(e.target.value) || 0)}
                  step="0.001"
                  disabled={orderType === 'auto'}
                />
              </div>
            </div>
            
            {livePrice != null && (
              <div className="form-group">
                <label>实时价格</label>
                <div className="input-group">
                  <span className="input-prefix">¥</span>
                  <input
                    type="number"
                    value={livePrice.toFixed(3)}
                    readOnly
                  />
                  <button className="btn btn-small" onClick={handleLivePriceUse}>
                    使用
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="order-section">
          <h3>网格参数配置</h3>
          
          <div className="form-row">
            <div className="form-group">
              <label>网格数量</label>
              <input
                type="range"
                min="4"
                max="16"
                value={gridCount}
                onChange={(e) => setGridCount(parseInt(e.target.value))}
              />
              <span className="range-value">{gridCount} 格</span>
            </div>
            
            <div className="form-group">
              <label>每格步长</label>
              <div className="input-group">
                <input
                  type="number"
                  value={gridStep}
                  onChange={(e) => setGridStep(parseFloat(e.target.value) || 0)}
                  step="0.001"
                />
                <span className="input-suffix">元</span>
              </div>
            </div>
            
            <div className="form-group">
              <label>每格份数</label>
              <div className="input-group">
                <input
                  type="number"
                  value={sharesPerGrid}
                  onChange={(e) => setSharesPerGrid(parseInt(e.target.value) || 0)}
                  step="100"
                />
                <span className="input-suffix">份</span>
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>总资金</label>
              <div className="input-group">
                <span className="input-prefix">¥</span>
                <input
                  type="number"
                  value={totalCapital}
                  onChange={(e) => setTotalCapital(parseInt(e.target.value) || 0)}
                  step="10000"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="order-section">
          <h3>网格预览</h3>
          <div className="grid-preview">
            {gridLines.map((line) => (
              <div
                key={line.index}
                className={`grid-line ${line.status} ${line.type}`}
              >
                <span className={`grid-tag tag-${line.type}`}>{line.label}</span>
                <span className="grid-price">¥{line.price.toFixed(3)}</span>
                <span className={`grid-status status-${line.status}`}>
                  {line.status === 'current' ? '◀ 基准' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="order-section">
          <h3>下单预览</h3>
          <div className="preview-table">
            <div className="preview-row">
              <span className="preview-label">品种</span>
              <span className="preview-value">{selectedProduct.name} ({selectedProduct.code})</span>
            </div>
            <div className="preview-row">
              <span className="preview-label">基准价格</span>
              <span className="preview-value">¥{basePrice.toFixed(3)}</span>
            </div>
            <div className="preview-row">
              <span className="preview-label">网格范围</span>
              <span className="preview-value">
                ¥{grids[0].toFixed(3)} ~ ¥{grids[grids.length - 1].toFixed(3)}
              </span>
            </div>
            <div className="preview-row">
              <span className="preview-label">每格步长</span>
              <span className="preview-value">¥{gridStep} ({(gridStep / basePrice * 100).toFixed(2)}%)</span>
            </div>
            <div className="preview-row">
              <span className="preview-label">每格数量</span>
              <span className="preview-value">{sharesPerGrid.toLocaleString()} 份</span>
            </div>
            <div className="preview-row">
              <span className="preview-label">初始仓位</span>
              <span className="preview-value">{estimatedInitialPosition().toLocaleString()} 份</span>
            </div>
            <div className="preview-row preview-total">
              <span className="preview-label">总资金</span>
              <span className="preview-value">¥{totalCapital.toLocaleString()}</span>
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
            <p>您即将提交以下网格交易订单：</p>
            <div className="modal-content">
              <div className="modal-row">
                <span>品种：</span>
                <span>{selectedProduct.name} ({selectedProduct.code})</span>
              </div>
              <div className="modal-row">
                <span>基准价格：</span>
                <span>¥{basePrice.toFixed(3)}</span>
              </div>
              <div className="modal-row">
                <span>网格数量：</span>
                <span>{gridCount} 格</span>
              </div>
              <div className="modal-row">
                <span>总资金：</span>
                <span>¥{totalCapital.toLocaleString()}</span>
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