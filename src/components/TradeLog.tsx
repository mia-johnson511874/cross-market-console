// 交易记录组件

import type { TradeLogEntry } from '../hooks/useGrid';

interface TradeLogProps {
  logs: TradeLogEntry[];
}

export default function TradeLog({ logs }: TradeLogProps) {
  if (logs.length === 0) {
    return (
      <div className="trade-log">
        <h3>📋 交易记录</h3>
        <div className="log-empty">暂无交易记录，开始模拟操作吧</div>
      </div>
    );
  }

  return (
    <div className="trade-log">
      <h3>📋 交易记录 <span className="log-count">({logs.length})</span></h3>
      <div className="log-list">
        {logs.map((log) => (
          <div key={log.id} className={`log-entry log-${log.side}`}>
            <span className="log-time">{log.time}</span>
            <span className={`log-side-badge badge-${log.side}`}>
              {log.side === 'grid' ? '网格' : '期权'}
            </span>
            <span className="log-msg">{log.message}</span>
            {log.pairNote && (
              <span className="log-pair-note">{log.pairNote}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
