// 跨市场策略控制台 - 主应用

import { useState, useCallback, useMemo } from 'react';
import GridPanel from './components/GridPanel';
import OptionPanel from './components/OptionPanel';
import CrossPairNotice from './components/CrossPairNotice';
import TradeLog from './components/TradeLog';
import Overview from './components/Overview';
import { gridProducts } from './data/gridProducts';
import { optionProducts } from './data/optionProducts';
import { findCrossPair } from './data/crossPairs';
import { useGrid, type TradeLogEntry } from './hooks/useGrid';
import { useOption } from './hooks/useOption';
import './App.css';

export default function App() {
  // 交易日志
  const [logs, setLogs] = useState<TradeLogEntry[]>([]);

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

  // 初始品种
  const [selectedGrid, setSelectedGrid] = useState(() => gridProducts[0]);
  const [selectedOption, setSelectedOption] = useState(() => optionProducts[0]);

  // 网格 Hook
  const grid = useGrid(selectedGrid, addLog);

  // 期权 Hook
  const option = useOption(selectedOption, addLog);

  // 品种切换处理
  const handleGridChange = useCallback(
    (p: typeof selectedGrid) => {
      setSelectedGrid(p);
      grid.resetWithProduct(p);
    },
    [grid]
  );

  const handleOptionChange = useCallback(
    (p: typeof selectedOption) => {
      setSelectedOption(p);
      option.resetWithProduct(p);
    },
    [option]
  );

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

  return (
    <div className="app">
      <header className="app-header">
        <h1>🏦 跨市场策略控制台</h1>
        <span className="subtitle">Cross-Market Strategy Console</span>
      </header>

      <main className="main-content">
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
        />

        {/* 交易记录 */}
        <TradeLog logs={logs} />
      </main>

      <footer className="app-footer">
        <span>仅供学习与研究使用 | 模拟数据，非真实行情 | 投资有风险，入市需谨慎</span>
      </footer>
    </div>
  );
}
