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

  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveChangePct, setLiveChangePct] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [isSimulated, setIsSimulated] = useState<boolean>(false);
  const [dataSource, setDataSource] = useState<string | undefined>(undefined);
  
  const productRef = useRef(product);
  productRef.current = product;
  
  const prevLivePriceRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      const snapshot = await fetchGridSnapshot(productRef.current.id);
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
    };

    poll();
    intervalId = setInterval(poll, 10000);

    return () => {
      mounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [product.id]);

  useEffect(() => {
    checkHealth().then(setIsOnline);
  }, []);

  // 自动网格触发：当实时价格穿越网格线时自动买卖
  useEffect(() => {
    if (livePrice === null || prevLivePriceRef.current === null) {
      prevLivePriceRef.current = livePrice;
      return;
    }

    const prevPrice = prevLivePriceRef.current;
    const currPrice = livePrice;
    const grids = product.grids;
    
    for (let i = 0; i < grids.length - 1; i++) {
      const lower = grids[i];
      const upper = grids[i + 1];
      
      if (prevPrice >= upper && currPrice < upper) {
        setState((prevState) => {
          if (prevState.currentIdx > i) {
            try {
              const newState = simulateGridMove(-1, prevState, product);
              const newPrice = product.grids[newState.currentIdx];
              addLog({
                time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                message: `自动买入: ${product.name} @ ${newPrice.toFixed(3)} (价格跌破 ${upper.toFixed(3)})`,
                side: 'grid',
              });
              return newState;
            } catch {
              return prevState;
            }
          }
          return prevState;
        });
        break;
      }
      
      if (prevPrice <= lower && currPrice > lower) {
        setState((prevState) => {
          if (prevState.currentIdx <= i) {
            try {
              const newState = simulateGridMove(1, prevState, product);
              const newPrice = product.grids[newState.currentIdx];
              addLog({
                time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
                message: `自动卖出: ${product.name} @ ${newPrice.toFixed(3)} (价格突破 ${lower.toFixed(3)})`,
                side: 'grid',
              });
              return newState;
            } catch {
              return prevState;
            }
          }
          return prevState;
        });
        break;
      }
    }

    prevLivePriceRef.current = currPrice;
  }, [livePrice, product, addLog]);

  const resetWithProduct = useCallback(
    (newProduct: GridProduct) => {
      setState(initGridState(newProduct));
      setError(null);
      setLivePrice(null);
      prevLivePriceRef.current = null;
      addLog({
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: `切换品种: ${newProduct.name} (${newProduct.code})`,
        side: 'grid',
      });
    },
    [addLog]
  );

  const moveDown = useCallback(() => {
    setState((prev) => {
      try {
        const newState = simulateGridMove(-1, prev, product);
        setError(null);
        const oldPrice = product.grids[prev.currentIdx];
        const newPrice = product.grids[newState.currentIdx];
        addLog({
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          message: `手动买入: ${product.name} @ ${newPrice.toFixed(3)} (从 ${oldPrice.toFixed(3)})`,
          side: 'grid',
        });
        return newState;
      } catch (e) {
        setError((e as Error).message);
        return prev;
      }
    });
  }, [product, addLog]);

  const moveUp = useCallback(() => {
    setState((prev) => {
      try {
        const newState = simulateGridMove(1, prev, product);
        setError(null);
        const oldPrice = product.grids[prev.currentIdx];
        const newPrice = product.grids[newState.currentIdx];
        addLog({
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          message: `手动卖出: ${product.name} @ ${newPrice.toFixed(3)} (从 ${oldPrice.toFixed(3)})`,
          side: 'grid',
        });
        return newState;
      } catch (e) {
        setError((e as Error).message);
        return prev;
      }
    });
  }, [product, addLog]);

  const reset = useCallback(() => {
    setState(initGridState(product));
    setError(null);
    prevLivePriceRef.current = null;
    addLog({
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      message: `重置网格: ${product.name}`,
      side: 'grid',
    });
  }, [product, addLog]);

  const currentPrice = livePrice ?? product.grids[state.currentIdx];
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
    isSimulated,
    dataSource,
    moveDown,
    moveUp,
    reset,
    resetWithProduct,
  };
}