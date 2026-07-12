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
        if (snapshot && snapshot.live_price !== null && !snapshot.error) {
          setLivePrice(snapshot.live_price);
          setLiveChangePct(snapshot.change_pct ?? null);
          setIsOnline(true);
        } else {
          setIsOnline(false);
        }
      }
    };

    poll();
    intervalId = setInterval(poll, 5000);

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
    'opt-50': 'a-hstech',       // 使用已有 ETF 产品 ID 获取价格
    'opt-300': 'a-hsi',
    'opt-300sz': 'a-hsi',
    'opt-500': 'a-hsi2',
    'opt-kc50': 'a-hstech2',
    'opt-hstech': 'a-hstech',
    'opt-au': 'a-gold',
    'opt-ag': 'a-silver',
    'opt-cu': 'a-metal',
    'opt-m': 'a-doupo',
    'opt-rb': 'a-metal',
  };
  return map[optionId] ?? null;
}
