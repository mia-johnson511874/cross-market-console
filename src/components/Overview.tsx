// 组合概览组件 (底部)

import { getMarketStatus } from '../utils/optionEngine';
import type { OptionState } from '../utils/optionEngine';
import type { DataSourcesResponse } from '../services/marketData';

interface OverviewProps {
  gridPnl: number;
  optionPnl: number;
  gridTrades: number;
  optionTrades: number;
  optionCurrency: string;
  optionState: OptionState;
  isPaired: boolean;
  isCrossProduct: boolean;
  dataSources?: DataSourcesResponse | null;
  gridOnline?: boolean;
  optionOnline?: boolean;
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
  dataSources,
  gridOnline,
  optionOnline,
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

  // 数据源状态
  const dataMode = dataSources?.mode ?? 'unknown';
  const anyReal = dataSources?.any_real_data ?? false;

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

        {/* 数据源状态 */}
        <div className="overview-item">
          <span className="ov-label">📡 数据源</span>
          <span className={`ov-value ${anyReal ? 'pnl-positive' : dataMode === 'unknown' ? '' : 'pnl-negative'}`}>
            {dataMode === 'live'
              ? '✅ 真实行情'
              : dataMode === 'simulated'
                ? '📡 模拟数据'
                : '⏳ 检测中...'}
          </span>
        </div>

        {/* 主数据源详情 */}
        {dataSources?.sources && (
          <div className="overview-item">
            <span className="ov-label">主数据源</span>
            <span className={`ov-value ${dataSources.sources.eastmoney?.available || dataSources.sources.yfinance?.available ? 'pnl-positive' : ''}`}>
              {dataSources.sources.eastmoney?.available
                ? `东方财富 (${dataSources.sources.eastmoney.latency_ms}ms)`
                : dataSources.sources.yfinance?.available
                  ? `Yahoo Finance (${dataSources.sources.yfinance.latency_ms}ms)`
                  : dataSources.sources.akshare_etf?.available
                    ? `akshare (${dataSources.sources.akshare_etf.latency_ms}ms)`
                    : '无可用数据源'}
            </span>
          </div>
        )}

        {/* 网格/期权在线状态 */}
        <div className="overview-item">
          <span className="ov-label">网格行情</span>
          <span className={`ov-value ${gridOnline ? 'pnl-positive' : ''}`}>
            {gridOnline === undefined ? '—' : gridOnline ? '🟢 在线' : '⚫ 离线'}
          </span>
        </div>
        <div className="overview-item">
          <span className="ov-label">期权行情</span>
          <span className={`ov-value ${optionOnline ? 'pnl-positive' : ''}`}>
            {optionOnline === undefined ? '—' : optionOnline ? '🟢 在线' : '⚫ 离线'}
          </span>
        </div>

        {isCrossProduct && (
          <div className="overview-item warning-item">
            <span className="ov-label">⚠️ 基差风险</span>
            <span className="ov-value risk-medium">跨品种配对存在基差</span>
          </div>
        )}

        {/* 期权汇率 */}
        <div className="overview-item" style={{ gridColumn: isCrossProduct ? undefined : 'span 1' }}>
          <span className="ov-label">期权汇率</span>
          <span className="ov-value">
            {optionCurrency === 'HKD' ? `${fxRate} (HKD→CNY)` : '本位币'}
          </span>
        </div>
      </div>

      {/* 数据源详情 */}
      {dataSources?.sources && (
        <div className="data-source-detail">
          <h4>🔍 数据源详情</h4>
          <div className="source-grid">
            {Object.entries(dataSources.sources).map(([key, src]) => {
              const names: Record<string, string> = {
                eastmoney: '东方财富',
                yfinance: 'Yahoo Finance',
                akshare_etf: 'akshare ETF',
                akshare_futures: 'akshare 期货',
                akshare_hk_index: 'akshare 港股',
                akshare_options: 'akshare 期权',
              };
              return (
                <div key={key} className={`source-item ${src.available ? 'source-ok' : 'source-fail'}`}>
                  <span className="source-name">{names[key] || key}</span>
                  <span className="source-status">
                    {src.available ? '✅' : '❌'}
                  </span>
                  <span className="source-latency">
                    {src.latency_ms > 0 ? `${src.latency_ms}ms` : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
