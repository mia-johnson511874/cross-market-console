// 网格交易状态管理 Hook

import { useState, useCallback, useEffect, useRef } from 'react';
import type { GridProduct } from '../data/gridProducts';
import {
  type GridState,
  initGridState,
  simulateGridMove,
} from '../utils/gridEngine';
import { fetchGridSnapshot, checkHealth } from '../services/marketData';

export interface TradeLogEntry {
  id: number;
  time: string;
  message: string;
  side: 'grid' | 'option';
  pairNote?: string;
}

export function useGrid(
  product: GridProduct,
  addLog: (entry: Omit<TradeLogEntry, 'id'>) => void
) {
  const [state, setState] = useState<GridState>(() => initGridState(product));
  const [error, setError] = useState<string | null>(null);

  // 实时行情状态
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveChangePct, setLiveChangePct] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const productRef = useRef(product);
  productRef.current = product;

  // 轮询实时价格
  useEffect(() => {
    let mounted = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      const snapshot = await fetchGridSnapshot(productRef.current.id);
      if (!mounted) return;
      if (snapshot && snapshot.live_price !== null && !snapshot.error) {
        setLivePrice(snapshot.live_price);
        setLiveChangePct(snapshot.change_pct ?? null);
        setIsOnline(true);
      } else {
        setIsOnline(false);
      }
    };

    // 立即获取一次
    poll();

    // 每5秒轮询
    intervalId = setInterval(poll, 5000);

    return () => {
      mounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [product.id]);

  // 健康检查
  useEffect(() => {
    checkHealth().then(setIsOnline);
  }, []);

  // 品种切换时重置
  const resetWithProduct = useCallback(
    (newProduct: GridProduct) => {
      setState(initGridState(newProduct));
      setError(null);
      setLivePrice(null);
      addLog({
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: `切换品种: ${newProduct.name} (${newProduct.code})`,
        side: 'grid',
      });
    },
    [addLog]
  );

  // 下跌一格 (买入)
  const moveDown = useCallback(() => {
    setState((prev) => {
      try {
        const newState = simulateGridMove(-1, prev, product);
        setError(null);
        const oldPrice = product.grids[prev.currentIdx];
        const newPrice = product.grids[newState.currentIdx];
        addLog({
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          message: `网格买入: ${product.name} @ ${newPrice.toFixed(3)} (下跌从 ${oldPrice.toFixed(3)})，买入${product.sharesPerGrid}份`,
          side: 'grid',
        });
        return newState;
      } catch (e) {
        setError((e as Error).message);
        return prev;
      }
    });
  }, [product, addLog]);

  // 上涨一格 (卖出)
  const moveUp = useCallback(() => {
    setState((prev) => {
      try {
        const newState = simulateGridMove(1, prev, product);
        setError(null);
        const oldPrice = product.grids[prev.currentIdx];
        const newPrice = product.grids[newState.currentIdx];
        addLog({
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          message: `网格卖出: ${product.name} @ ${newPrice.toFixed(3)} (上涨从 ${oldPrice.toFixed(3)})，卖出${product.sharesPerGrid}份`,
          side: 'grid',
        });
        return newState;
      } catch (e) {
        setError((e as Error).message);
        return prev;
      }
    });
  }, [product, addLog]);

  // 重置
  const reset = useCallback(() => {
    setState(initGridState(product));
    setError(null);
    addLog({
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      message: `重置网格: ${product.name}`,
      side: 'grid',
    });
  }, [product, addLog]);

  const currentPrice = product.grids[state.currentIdx];
  const capitalRatio = (state.capitalUsed / product.totalCapital) * 100;

  return {
    state,
    product,
    error,
    currentPrice,
    capitalRatio,
    livePrice,
    liveChangePct,
    isOnline,
    moveDown,
    moveUp,
    reset,
    resetWithProduct,
  };
}
