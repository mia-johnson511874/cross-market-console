// 期权双日历价差状态管理 Hook

import { useState, useCallback, useEffect, useRef } from 'react';
import type { OptionProduct } from '../data/optionProducts';
import {
  type OptionState,
  initOptionState,
  simulateOptionMove,
  simulateTimeDecay,
} from '../utils/optionEngine';
import { fetchGridSnapshot } from '../services/marketData';
import type { TradeLogEntry } from './useGrid';

export function useOption(
  product: OptionProduct,
  addLog: (entry: Omit<TradeLogEntry, 'id'>) => void
) {
  const [state, setState] = useState<OptionState>(() =>
    initOptionState(product)
  );

  // 实时行情状态
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveChangePct, setLiveChangePct] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [isSimulated, setIsSimulated] = useState<boolean>(false);
  const [dataSource, setDataSource] = useState<string | undefined>(undefined);
  const productRef = useRef(product);
  productRef.current = product;

  // 轮询实时标的物价格
  useEffect(() => {
    let mounted = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      const productId = productRef.current.id;
      const gridId = optionToGridId(productId);
      if (gridId) {
        const snapshot = await fetchGridSnapshot(gridId);
        if (!mounted) return;
        if (snapshot && snapshot.live_price !== null) {
          setLivePrice(snapshot.live_price);
          setLiveChangePct(snapshot.change_pct ?? null);
          setIsOnline(true);
          setIsSimulated(snapshot.simulated === true);
          setDataSource(snapshot.source ?? undefined);
        } else {
          setIsOnline(false);
          setIsSimulated(false);
          setDataSource(undefined);
        }
      }
    };

    poll();
    // 每10秒轮询（与后端15秒缓存对齐，避免无效请求）
    intervalId = setInterval(poll, 10000);

    return () => {
      mounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [product.id]);

  // 品种切换时重置
  const resetWithProduct = useCallback(
    (newProduct: OptionProduct) => {
      setState(initOptionState(newProduct));
      setLivePrice(null);
      addLog({
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: `切换期权品种: ${newProduct.name} (${newProduct.code})`,
        side: 'option',
      });
    },
    [addLog]
  );

  // 标的下跌
  const moveDown = useCallback(() => {
    setState((prev) => {
      const newState = simulateOptionMove(-1, prev, product);
      addLog({
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: `标的大跌: ${product.name} 指数 ${prev.index.toFixed(1)} → ${newState.index.toFixed(1)} (-3%)`,
        side: 'option',
      });
      return newState;
    });
  }, [product, addLog]);

  // 标的上涨
  const moveUp = useCallback(() => {
    setState((prev) => {
      const newState = simulateOptionMove(1, prev, product);
      addLog({
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: `标的大涨: ${product.name} 指数 ${prev.index.toFixed(1)} → ${newState.index.toFixed(1)} (+3%)`,
        side: 'option',
      });
      return newState;
    });
  }, [product, addLog]);

  // 时间流逝1天
  const timePass = useCallback(() => {
    setState((prev) => {
      const newState = simulateTimeDecay(prev);
      addLog({
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: `时间流逝: ${product.name} 近月剩余${newState.daysToNear}天，远月剩余${newState.daysToFar}天，Theta收益 ${prev.greeks.theta.toFixed(1)} pts`,
        side: 'option',
      });
      return newState;
    });
  }, [product, addLog]);

  // 重置
  const reset = useCallback(() => {
    setState(initOptionState(product));
    addLog({
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      message: `重置期权: ${product.name}`,
      side: 'option',
    });
  }, [product, addLog]);

  // 计算四条腿的显示信息
  const legs = [
    {
      label: '卖出近月Call',
      type: 'sell' as const,
      strike: state.strike,
      premium: state.nearCallPremium,
      color: 'green',
    },
    {
      label: '卖出近月Put',
      type: 'sell' as const,
      strike: state.strike,
      premium: state.nearPutPremium,
      color: 'green',
    },
    {
      label: '买入远月Call',
      type: 'buy' as const,
      strike: state.strike,
      premium: state.farCallCost,
      color: 'red',
    },
    {
      label: '买入远月Put',
      type: 'buy' as const,
      strike: state.strike,
      premium: state.farPutCost,
      color: 'red',
    },
  ];

  return {
    state,
    product,
    legs,
    livePrice,
    liveChangePct,
    isOnline,
    isSimulated,
    dataSource,
    moveDown,
    moveUp,
    timePass,
    reset,
    resetWithProduct,
  };
}

/**
 * 期权 ID → 对应 grid product ID 映射
 * 用于通过快照接口获取标的物实时价格
 */
function optionToGridId(optionId: string): string | null {
  const map: Record<string, string> = {
    'opt-50': 'a-50etf',        // 上证50ETF期权 → 上证50ETF
    'opt-300': 'a-300etf',      // 沪深300ETF期权(沪) → 沪深300ETF(沪)
    'opt-300sz': 'a-300etf-sz', // 沪深300ETF期权(深) → 沪深300ETF(深)
    'opt-500': 'a-500etf',      // 中证500ETF期权 → 中证500ETF
    'opt-kc50': 'a-kc50',       // 科创50ETF期权 → 科创50ETF
    'opt-hstech': 'a-hstech',    // 恒生科技指数期权 → 恒生科技ETF
    'opt-au': 'a-gold',         // 黄金期权 → 黄金ETF
    'opt-ag': 'a-silver',       // 白银期权 → 白银LOF
    'opt-cu': 'a-metal',        // 铜期权 → 有色金属ETF
    'opt-m': 'a-doupo',         // 豆粕期权 → 豆粕ETF
    'opt-rb': 'a-metal',        // 螺纹钢期权 → 有色金属ETF
  };
  return map[optionId] ?? null;
}
