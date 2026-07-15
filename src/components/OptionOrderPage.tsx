import { useState, useCallback, useMemo } from 'react';
import type { OptionProduct } from '../data/optionProducts';
import { optionProducts, marketTypeLabels } from '../data/optionProducts';
import type { Greeks } from '../data/optionProducts';

interface OptionOrderPageProps {
  onSubmit: (product: OptionProduct, order: OptionOrder) => void;
  onCancel: () => void;
  livePrice?: number | null;
}

export interface OptionOrder {
  productId: string;
  nearStrike: number;
  farStrike: number;
  nearCallPremium: number;
  nearPutPremium: number;
  farCallCost: number;
  farPutCost: number;
  daysToNear: number;
  daysToFar: number;
  contractCount: number;
  netPremium: number;
}

const groupedOptions = optionProducts.reduce(
  (acc, p) => {
    const cat = marketTypeLabels[p.marketType];
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  },
  {} as Record<string, OptionProduct[]>
);

export default function OptionOrderPage({ onSubmit, onCancel, livePrice }: OptionOrderPageProps) {
  const [selectedProduct, setSelectedProduct] = useState<OptionProduct>(optionProducts[0]);
  
  const [nearStrike, setNearStrike] = useState(selectedProduct.strike);
  const [farStrike, setFarStrike] = useState(selectedProduct.strike);
  
  const [nearCallPremium, setNearCallPremium] = useState(selectedProduct.nearCall);
  const [nearPutPremium, setNearPutPremium] = useState(selectedProduct.nearPut);
  const [farCallCost, setFarCallCost] = useState(selectedProduct.farCall);
  const [farPutCost, setFarPutCost] = useState(selectedProduct.farPut);
  
  const [daysToNear, setDaysToNear] = useState(selectedProduct.daysNear);
  const [daysToFar, setDaysToNearFar] = useState(selectedProduct.daysFar);
  
  const [contractCount, setContractCount] = useState(1);
  const [orderType, setOrderType] = useState<'auto' | 'manual'>('auto');
  const [confirmModal, setConfirmModal] = useState(false);

  const handleProductChange = useCallback((p: OptionProduct) => {
    setSelectedProduct(p);
    setNearStrike(p.strike);
    setFarStrike(p.strike);
    setNearCallPremium(p.nearCall);
    setNearPutPremium(p.nearPut);
    setFarCallCost(p.farCall);
    setFarPutCost(p.farPut);
    setDaysToNear(p.daysNear);
    setDaysToNearFar(p.daysFar);
  }, []);

  const handleLivePriceUse = useCallback(() => {
    if (livePrice) {
      setNearStrike(livePrice);
      setFarStrike(livePrice);
      setOrderType('manual');
    }
  }, [livePrice]);

  const netPremium = useMemo(() => {
    const nearIncome = (nearCallPremium + nearPutPremium) * contractCount;
    const farCost = (farCallCost + farPutCost) * contractCount;
    return nearIncome - farCost;
  }, [nearCallPremium, nearPutPremium, farCallCost, farPutCost, contractCount]);

  const totalMargin = useMemo(() => {
    return Math.max(
      nearCallPremium * contractCount * 5,
      farCallCost * contractCount * 10
    );
  }, [nearCallPremium, farCallCost, contractCount]);

  const greeks: Greeks = useMemo(() => {
    const diff = Math.abs(nearStrike - farStrike);
    return {
      delta: Math.round(diff * 0.02 * 10000) / 10000,
      gamma: Math.round((-10 - diff * 0.01) * 100) / 100,
      theta: Math.round((15 + daysToNear * 0.5) * 100) / 100,
      vega: Math.round((8 + daysToFar * 0.3) * 100) / 100,
    };
  }, [nearStrike, farStrike, daysToNear, daysToFar]);

  const legs = useMemo(() => [
    {
      label: '近月认购',
      type: 'sell' as const,
      strike: nearStrike,
      premium: nearCallPremium,
      color: 'green',
    },
    {
      label: '近月认沽',
      type: 'sell' as const,
      strike: nearStrike,
      premium: nearPutPremium,
      color: 'green',
    },
    {
      label: '远月认购',
      type: 'buy' as const,
      strike: farStrike,
      premium: farCallCost,
      color: 'red',
    },
    {
      label: '远月认沽',
      type: 'buy' as const,
      strike: farStrike,
      premium: farPutCost,
      color: 'red',
    },
  ], [nearStrike, nearCallPremium, nearPutPremium, farStrike, farCallCost, farPutCost]);

  const handleSubmit = () => {
    setConfirmModal(true);
  };

  const confirmOrder = () => {
    const order: OptionOrder = {
      productId: selectedProduct.id,
      nearStrike,
      farStrike,
      nearCallPremium,
      nearPutPremium,
      farCallCost,
      farPutCost,
      daysToNear,
      daysToFar,
      contractCount,
      netPremium,
    };
    onSubmit(selectedProduct, order);
    setConfirmModal(false);
  };

  return (
    <div className="order-page">
      <div className="order-header">
        <h2>📅 双日历价差期权下单</h2>
        <button className="btn btn-cancel" onClick={onCancel}>
          ← 返回
        </button>
      </div>

      <div className="order-content">
        <div className="order-section">
          <h3>基本信息</h3>
          
          <div className="form-row">
            <div className="form-group">
              <label>期权品种</label>
              <select
                value={selectedProduct.id}
                onChange={(e) => {
                  const p = optionProducts.find((o) => o.id === e.target.value);
                  if (p) handleProductChange(p);
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
              <label>下单类型</label>
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    checked={orderType === 'auto'}
                    onChange={() => setOrderType('auto')}
                  />
                  自动行权价 (品种默认)
                </label>
                <label>
                  <input
                    type="radio"
                    checked={orderType === 'manual'}
                    onChange={() => setOrderType('manual')}
                  />
                  手动行权价
                </label>
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>标的实时价格</label>
              {livePrice != null ? (
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
              ) : (
                <span className="text-muted">暂无实时数据</span>
              )}
            </div>
          </div>
        </div>

        <div className="order-section">
          <h3>行权价设置</h3>
          
          <div className="form-row">
            <div className="form-group">
              <label>近月行权价</label>
              <div className="input-group">
                <span className="input-prefix">¥</span>
                <input
                  type="number"
                  value={nearStrike.toFixed(selectedProduct.price > 100 ? 0 : 2)}
                  onChange={(e) => setNearStrike(parseFloat(e.target.value) || 0)}
                  disabled={orderType === 'auto'}
                />
              </div>
            </div>
            
            <div className="form-group">
              <label>远月行权价</label>
              <div className="input-group">
                <span className="input-prefix">¥</span>
                <input
                  type="number"
                  value={farStrike.toFixed(selectedProduct.price > 100 ? 0 : 2)}
                  onChange={(e) => setFarStrike(parseFloat(e.target.value) || 0)}
                  disabled={orderType === 'auto'}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="order-section">
          <h3>时间设置</h3>
          
          <div className="form-row">
            <div className="form-group">
              <label>近月到期天数</label>
              <input
                type="range"
                min="7"
                max="45"
                value={daysToNear}
                onChange={(e) => setDaysToNear(parseInt(e.target.value))}
              />
              <span className="range-value">{daysToNear} 天</span>
            </div>
            
            <div className="form-group">
              <label>远月到期天数</label>
              <input
                type="range"
                min="30"
                max="90"
                value={daysToFar}
                onChange={(e) => setDaysToNearFar(parseInt(e.target.value))}
              />
              <span className="range-value">{daysToFar} 天</span>
            </div>
            
            <div className="form-group">
              <label>合约数量</label>
              <div className="input-group">
                <input
                  type="number"
                  value={contractCount}
                  onChange={(e) => setContractCount(Math.max(1, parseInt(e.target.value) || 1))}
                  min="1"
                  max="10"
                />
                <span className="input-suffix">张</span>
              </div>
            </div>
          </div>
        </div>

        <div className="order-section">
          <h3>权利金设置</h3>
          
          <div className="form-row">
            <div className="form-group">
              <label>近月认购权利金</label>
              <div className="input-group">
                <input
                  type="number"
                  value={nearCallPremium.toFixed(selectedProduct.price > 100 ? 2 : 4)}
                  onChange={(e) => setNearCallPremium(parseFloat(e.target.value) || 0)}
                  step="0.01"
                />
                <span className="input-suffix">pts</span>
              </div>
            </div>
            
            <div className="form-group">
              <label>近月认沽权利金</label>
              <div className="input-group">
                <input
                  type="number"
                  value={nearPutPremium.toFixed(selectedProduct.price > 100 ? 2 : 4)}
                  onChange={(e) => setNearPutPremium(parseFloat(e.target.value) || 0)}
                  step="0.01"
                />
                <span className="input-suffix">pts</span>
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>远月认购成本</label>
              <div className="input-group">
                <input
                  type="number"
                  value={farCallCost.toFixed(selectedProduct.price > 100 ? 2 : 4)}
                  onChange={(e) => setFarCallCost(parseFloat(e.target.value) || 0)}
                  step="0.01"
                />
                <span className="input-suffix">pts</span>
              </div>
            </div>
            
            <div className="form-group">
              <label>远月认沽成本</label>
              <div className="input-group">
                <input
                  type="number"
                  value={farPutCost.toFixed(selectedProduct.price > 100 ? 2 : 4)}
                  onChange={(e) => setFarPutCost(parseFloat(e.target.value) || 0)}
                  step="0.01"
                />
                <span className="input-suffix">pts</span>
              </div>
            </div>
          </div>
        </div>

        <div className="order-section">
          <h3>四腿结构预览</h3>
          <div className="option-legs">
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
        </div>

        <div className="order-section">
          <h3>希腊字母</h3>
          <div className="greeks-grid">
            <div className="greek-item">
              <span className="greek-label">Δ Delta</span>
              <span className={`greek-value ${greeks.delta >= 0 ? 'positive' : 'negative'}`}>
                {greeks.delta.toFixed(4)}
              </span>
            </div>
            <div className="greek-item">
              <span className="greek-label">Γ Gamma</span>
              <span className="greek-value">
                {greeks.gamma.toFixed(2)}
              </span>
            </div>
            <div className="greek-item">
              <span className="greek-label">Θ Theta</span>
              <span className="greek-value positive">
                +{greeks.theta.toFixed(2)}
              </span>
            </div>
            <div className="greek-item">
              <span className="greek-label">Ν Vega</span>
              <span className="greek-value">
                {greeks.vega.toFixed(2)}
              </span>
            </div>
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
              <span className="preview-label">近月行权价</span>
              <span className="preview-value">¥{nearStrike.toFixed(selectedProduct.price > 100 ? 0 : 2)}</span>
            </div>
            <div className="preview-row">
              <span className="preview-label">远月行权价</span>
              <span className="preview-value">¥{farStrike.toFixed(selectedProduct.price > 100 ? 0 : 2)}</span>
            </div>
            <div className="preview-row">
              <span className="preview-label">近月到期</span>
              <span className="preview-value">{daysToNear} 天</span>
            </div>
            <div className="preview-row">
              <span className="preview-label">远月到期</span>
              <span className="preview-value">{daysToFar} 天</span>
            </div>
            <div className="preview-row">
              <span className="preview-label">合约数量</span>
              <span className="preview-value">{contractCount} 张</span>
            </div>
            <div className="preview-row">
              <span className="preview-label">近月权利金收入</span>
              <span className="preview-value pnl-positive">+¥{((nearCallPremium + nearPutPremium) * contractCount * selectedProduct.pointValue).toFixed(2)}</span>
            </div>
            <div className="preview-row">
              <span className="preview-label">远月权利金支出</span>
              <span className="preview-value pnl-negative">-¥{((farCallCost + farPutCost) * contractCount * selectedProduct.pointValue).toFixed(2)}</span>
            </div>
            <div className="preview-row preview-total">
              <span className="preview-label">净权利金</span>
              <span className={`preview-value ${netPremium >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                {netPremium >= 0 ? '+' : ''}¥{(netPremium * selectedProduct.pointValue).toFixed(2)}
              </span>
            </div>
            <div className="preview-row">
              <span className="preview-label">预估保证金</span>
              <span className="preview-value">¥{(totalMargin * selectedProduct.pointValue).toFixed(2)}</span>
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
            <p>您即将提交以下双日历价差期权订单：</p>
            <div className="modal-content">
              <div className="modal-row">
                <span>品种：</span>
                <span>{selectedProduct.name} ({selectedProduct.code})</span>
              </div>
              <div className="modal-row">
                <span>行权价：</span>
                <span>¥{nearStrike.toFixed(selectedProduct.price > 100 ? 0 : 2)}</span>
              </div>
              <div className="modal-row">
                <span>合约数量：</span>
                <span>{contractCount} 张</span>
              </div>
              <div className="modal-row">
                <span>净权利金：</span>
                <span className={netPremium >= 0 ? 'pnl-positive' : 'pnl-negative'}>
                  {netPremium >= 0 ? '+' : ''}¥{(netPremium * selectedProduct.pointValue).toFixed(2)}
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