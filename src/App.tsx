// 跨市场策略控制台 - 主应用

import { useState, useCallback, useMemo, useEffect } from 'react';
import GridPanel from './components/GridPanel';
import OptionPanel from './components/OptionPanel';
import GridOrderPage from './components/GridOrderPage';
import OptionOrderPage from './components/OptionOrderPage';
import StraddleOrderPage, { type StraddleOrder } from './components/StraddleOrderPage';
import CrossPairNotice from './components/CrossPairNotice';
import TradeLog from './components/TradeLog';
import Overview from './components/Overview';
import { gridProducts } from './data/gridProducts';
import { optionProducts } from './data/optionProducts';
import { findCrossPair } from './data/crossPairs';
import { useGrid, type TradeLogEntry } from './hooks/useGrid';
import { useOption } from './hooks/useOption';
import { fetchDataSources, type DataSourcesResponse } from './services/marketData';
import './App.css';

type ActivePage = 'monitor' | 'grid-order' | 'option-order' | 'straddle-order';

export default function App() {
  // 当前活动页面
  const [activePage, setActivePage] = useState<ActivePage>('monitor');

  // 交易日志
  const [logs, setLogs] = useState<TradeLogEntry[]>([]);

  // 数据源状态
  const [dataSources, setDataSources] = useState<DataSourcesResponse | null>(null);

  const addLog = useCallback(
    (entry: Omit<TradeLogEntry, 'id'>) => {
      setLogs((prev) => {
        const newEntry = { ...entry, id: Date.now() };
        const updated = [newEntry, ...prev];
        return updated.slice(0, 50); // 最多50条
      });
    },
    []
  );

  // 初始品种 - 从 localStorage 读取上次选择
  const [selectedGrid, setSelectedGrid] = useState(() => {
    const savedId = localStorage.getItem('selectedGridId');
    const saved = gridProducts.find((p) => p.id === savedId);
    return saved || gridProducts[0];
  });
  const [selectedOption, setSelectedOption] = useState(() => {
    const savedId = localStorage.getItem('selectedOptionId');
    const saved = optionProducts.find((p) => p.id === savedId);
    return saved || optionProducts[0];
  });

  // 网格 Hook
  const grid = useGrid(selectedGrid, addLog);

  // 期权 Hook
  const option = useOption(selectedOption, addLog);

  // 品种切换处理 - 同时保存到 localStorage
  const handleGridChange = useCallback(
    (p: typeof selectedGrid) => {
      localStorage.setItem('selectedGridId', p.id);
      setSelectedGrid(p);
    },
    []
  );

  const handleOptionChange = useCallback(
    (p: typeof selectedOption) => {
      localStorage.setItem('selectedOptionId', p.id);
      setSelectedOption(p);
    },
    []
  );

  // 数据源检测
  useEffect(() => {
    fetchDataSources().then(setDataSources);
    const interval = setInterval(() => {
      fetchDataSources().then(setDataSources);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // 查找配对关系
  const crossPair = useMemo(
    () => findCrossPair(selectedGrid.id, selectedOption.id),
    [selectedGrid.id, selectedOption.id]
  );

  const isPaired = crossPair !== null;
  const isCrossProduct =
    isPaired &&
    (selectedGrid.category === 'commodity' ||
      selectedGrid.category === 'commodity-lof') &&
    selectedOption.marketType === 'commodity-option';

  // 配对品种名称
  const pairedOptionName = useMemo(() => {
    const pair = optionProducts.find(
      (o) => o.id === selectedGrid.pairedOption?.optionId
    );
    return pair ? `${pair.name} (${pair.code})` : undefined;
  }, [selectedGrid]);

  const pairedGridName = useMemo(() => {
    const pair = gridProducts.find(
      (g) => g.id === selectedOption.pairedGrid?.gridId
    );
    return pair ? `${pair.name} (${pair.code})` : undefined;
  }, [selectedOption]);

  const handleGridOrderSubmit = useCallback((product: typeof selectedGrid) => {
    addLog({
      time: new Date().toLocaleTimeString(),
      side: 'grid',
      message: `下单成功: ${product.name}`,
    });
    localStorage.setItem('selectedGridId', product.id);
    setSelectedGrid(product);
    setActivePage('monitor');
  }, [addLog]);

  const handleOptionOrderSubmit = useCallback((product: typeof selectedOption) => {
    addLog({
      time: new Date().toLocaleTimeString(),
      side: 'option',
      message: `下单成功: ${product.name}`,
    });
    localStorage.setItem('selectedOptionId', product.id);
    setSelectedOption(product);
    setActivePage('monitor');
  }, [addLog]);

  const handleStraddleOrderSubmit = useCallback(
    (product: typeof selectedOption, order: StraddleOrder) => {
      const structureLabel = order.structure === 'straddle' ? '跨式' : '宽跨式';
      addLog({
        time: new Date().toLocaleTimeString(),
        side: 'option',
        message: `${structureLabel}下单成功: ${product.name} 买${order.callStrike}C+买${order.putStrike}P ×${order.contracts}张, 净支出¥${order.netDebit.toFixed(2)}, 平衡点 ${order.lowerBreakeven?.toFixed(3) ?? '—'}~${order.upperBreakeven?.toFixed(3) ?? '—'}`,
      });
      localStorage.setItem('selectedOptionId', product.id);
      setSelectedOption(product);
      setActivePage('monitor');
    },
    [addLog]
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>🏦 跨市场策略控制台</h1>
        <span className="subtitle">Cross-Market Strategy Console</span>
      </header>

      <main className="main-content">
        {/* 页面导航 */}
        <div className="nav-tabs">
          <button
            className={`nav-tab ${activePage === 'monitor' ? 'active' : ''}`}
            onClick={() => setActivePage('monitor')}
          >
            📊 实时监控
          </button>
          <button
            className={`nav-tab ${activePage === 'grid-order' ? 'active' : ''}`}
            onClick={() => setActivePage('grid-order')}
          >
            📈 网格交易下单
          </button>
          <button
            className={`nav-tab ${activePage === 'option-order' ? 'active' : ''}`}
            onClick={() => setActivePage('option-order')}
          >
            📅 双日历价差期权
          </button>
          <button
            className={`nav-tab ${activePage === 'straddle-order' ? 'active' : ''}`}
            onClick={() => setActivePage('straddle-order')}
          >
            🎯 跨式期权
          </button>
        </div>

        {/* 下单页面 */}
        {activePage === 'grid-order' && (
          <GridOrderPage
            onSubmit={handleGridOrderSubmit}
            onCancel={() => setActivePage('monitor')}
            livePrice={grid.livePrice}
          />
        )}

        {activePage === 'option-order' && (
          <OptionOrderPage
            onSubmit={handleOptionOrderSubmit}
            onCancel={() => setActivePage('monitor')}
            livePrice={option.livePrice}
          />
        )}

        {activePage === 'straddle-order' && (
          <StraddleOrderPage
            onSubmit={handleStraddleOrderSubmit}
            onCancel={() => setActivePage('monitor')}
          />
        )}

        {/* 监控页面 */}
        {activePage === 'monitor' && (
          <>
            <div className="panels-container">
              <GridPanel
                selectedProduct={selectedGrid}
                onSelectProduct={handleGridChange}
                state={grid.state}
                currentPrice={grid.currentPrice}
                capitalRatio={grid.capitalRatio}
                error={grid.error}
                onMoveDown={grid.moveDown}
                onMoveUp={grid.moveUp}
                onReset={grid.reset}
                pairedOptionName={pairedOptionName}
                livePrice={grid.livePrice}
                liveChangePct={grid.liveChangePct}
                isOnline={grid.isOnline}
                isSimulated={grid.isSimulated}
                dataSource={grid.dataSource}
                unrealizedPnl={grid.unrealizedPnl}
                totalPnl={grid.totalPnl}
              />

              <div className="panel-divider" />

              <OptionPanel
                selectedProduct={selectedOption}
                onSelectProduct={handleOptionChange}
                state={option.state}
                legs={option.legs}
                onMoveDown={option.moveDown}
                onMoveUp={option.moveUp}
                onTimePass={option.timePass}
                onReset={option.reset}
                pairedGridName={pairedGridName}
                livePrice={option.livePrice}
                liveChangePct={option.liveChangePct}
                isOnline={option.isOnline}
                isSimulated={option.isSimulated}
                dataSource={option.dataSource}
              />
            </div>

            {/* 跨品种配对提示 */}
            <CrossPairNotice
              pair={crossPair}
              gridProduct={selectedGrid}
              optionProduct={selectedOption}
            />

            {/* 组合概览 */}
            <Overview
              gridPnl={grid.state.realizedPnl}
              optionPnl={option.state.realizedPnl}
              gridTrades={grid.state.trades}
              optionTrades={option.state.trades}
              optionCurrency={selectedOption.currency}
              optionState={option.state}
              isPaired={isPaired}
              isCrossProduct={isCrossProduct}
              dataSources={dataSources}
              gridOnline={grid.isOnline}
              optionOnline={option.isOnline}
            />

            {/* 交易记录 */}
            <TradeLog logs={logs} />
          </>
        )}
      </main>

      <footer className="app-footer">
        <span>仅供学习与研究使用 | {dataSources?.mode === 'live' ? '✅ 实时行情' : '📡 模拟数据'} | 投资有风险，入市需谨慎</span>
      </footer>
    </div>
  );
}
