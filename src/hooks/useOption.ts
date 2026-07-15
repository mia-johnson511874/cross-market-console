import { useState, useCallback, useEffect, useRef } from 'react';
import type { OptionProduct } from '../data/optionProducts';
import {
  type OptionState,
  initOptionState,
  simulateOptionMove,
  simulateTimeDecay,
} from '../utils/optionEngine';
import { fetchGridSnapshot, fetchOptionChain } from '../services/marketData';
import type { TradeLogEntry } from './useGrid';

export interface OptionChainData {
  underlying_code: string;
  underlying_name: string;
  expiry_months: string[];
  contracts: Array<{
    code: string;
    name: string;
    strike: number;
    expiry: string;
    type: string;
    latest_price: number | null;
    volume: number | null;
    open_interest: number | null;
    change_pct: number | null;
  }>;
}

export function useOption(
  product: OptionProduct,
  addLog: (entry: Omit<TradeLogEntry, 'id'>) => void
) {
  const [state, setState] = useState<OptionState>(() =>
    initOptionState(product)
  );

  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveChangePct, setLiveChangePct] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [isSimulated, setIsSimulated] = useState<boolean>(false);
  const [dataSource, setDataSource] = useState<string | undefined>(undefined);
  const [optionChain, setOptionChain] = useState<OptionChainData | null>(null);
  const productRef = useRef(product);
  productRef.current = product;

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
    intervalId = setInterval(poll, 10000);

    return () => {
      mounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [product.id]);

  useEffect(() => {
    let mounted = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const fetchChain = async () => {
      const productId = productRef.current.id;
      const underlying = optionToUnderlying(productId);
      if (underlying) {
        const chain = await fetchOptionChain(underlying);
        if (!mounted) return;
        if (chain && chain.contracts && chain.contracts.length > 0) {
          setOptionChain(chain);
          updateOptionPricesFromChain(chain);
        }
      }
    };

    const updateOptionPricesFromChain = (chain: OptionChainData) => {
      if (!livePrice) return;

      const nearMonth = chain.expiry_months[0] || '';
      const farMonth = chain.expiry_months[1] || chain.expiry_months[0] || '';

      const nearCall = findContract(chain, nearMonth, livePrice, '认购');
      const nearPut = findContract(chain, nearMonth, livePrice, '认沽');
      const farCall = findContract(chain, farMonth, livePrice, '认购');
      const farPut = findContract(chain, farMonth, livePrice, '认沽');

      setState((prev) => ({
        ...prev,
        index: livePrice,
        strike: livePrice,
        nearCallPremium: nearCall?.latest_price ?? prev.nearCallPremium,
        nearPutPremium: nearPut?.latest_price ?? prev.nearPutPremium,
        farCallCost: farCall?.latest_price ?? prev.farCallCost,
        farPutCost: farPut?.latest_price ?? prev.farPutCost,
      }));
    };

    const findContract = (
      chain: OptionChainData,
      expiry: string,
      targetStrike: number,
      optionType: string
    ) => {
      const candidates = chain.contracts.filter(
        (c) =>
          c.expiry.includes(expiry) &&
          c.type.includes(optionType) &&
          Math.abs(c.strike - targetStrike) < targetStrike * 0.05
      );
      if (candidates.length === 0) return null;
      return candidates.reduce((prev, curr) =>
        Math.abs(curr.strike - targetStrike) < Math.abs(prev.strike - targetStrike)
          ? curr
          : prev
      );
    };

    fetchChain();
    intervalId = setInterval(fetchChain, 30000);

    return () => {
      mounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [product.id, livePrice]);

  useEffect(() => {
    if (livePrice) {
      setState((prev) => ({
        ...prev,
        index: livePrice,
      }));
    }
  }, [livePrice]);

  const resetWithProduct = useCallback(
    (newProduct: OptionProduct) => {
      setState(initOptionState(newProduct));
      setLivePrice(null);
      setOptionChain(null);
      addLog({
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: `切换期权品种: ${newProduct.name} (${newProduct.code})`,
        side: 'option',
      });
    },
    [addLog]
  );

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

  const reset = useCallback(() => {
    setState(initOptionState(product));
    setOptionChain(null);
    addLog({
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      message: `重置期权: ${product.name}`,
      side: 'option',
    });
  }, [product, addLog]);

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
    optionChain,
    moveDown,
    moveUp,
    timePass,
    reset,
    resetWithProduct,
  };
}

function optionToGridId(optionId: string): string | null {
  const map: Record<string, string> = {
    'opt-50': 'a-50etf',
    'opt-300': 'a-300etf',
    'opt-300sz': 'a-300etf-sz',
    'opt-500': 'a-500etf',
    'opt-kc50': 'a-kc50',
    'opt-hstech': 'a-hstech',
    'opt-au': 'a-gold',
    'opt-ag': 'a-silver',
    'opt-cu': 'a-metal',
    'opt-m': 'a-doupo',
    'opt-rb': 'a-metal',
  };
  return map[optionId] ?? null;
}

function optionToUnderlying(optionId: string): string | null {
  const map: Record<string, string> = {
    'opt-50': '50ETF',
    'opt-300': '300ETF',
    'opt-300sz': '300ETF',
    'opt-500': '500ETF',
    'opt-kc50': 'KC50ETF',
    'opt-hstech': 'HSTECH',
  };
  return map[optionId] ?? null;
}