// 跨品种协同配对配置

export interface CrossPairConfig {
  gridId: string;
  optionId: string;
  correlation: number;
  basisRisk: 'low' | 'medium' | 'high';
  basisDescription: string;
  hedgeEfficiency: number;
}

export const crossPairs: CrossPairConfig[] = [
  {
    gridId: 'a-gold',
    optionId: 'opt-au',
    correlation: 0.95,
    basisRisk: 'medium',
    basisDescription: 'ETF跟踪现货Au99.99，期权跟踪黄金期货，存在期限结构和展期收益差异',
    hedgeEfficiency: 0.88,
  },
  {
    gridId: 'a-gold2',
    optionId: 'opt-au',
    correlation: 0.95,
    basisRisk: 'medium',
    basisDescription: '同上，ETF跟踪现货Au99.99，与黄金期货期权存在基差',
    hedgeEfficiency: 0.88,
  },
  {
    gridId: 'a-doupo',
    optionId: 'opt-m',
    correlation: 0.98,
    basisRisk: 'low',
    basisDescription: '豆粕ETF跟踪豆粕期货价格指数，与豆粕期权标的几乎一致',
    hedgeEfficiency: 0.95,
  },
  {
    gridId: 'a-silver',
    optionId: 'opt-ag',
    correlation: 0.98,
    basisRisk: 'low',
    basisDescription: '白银LOF绝大部分资产投资上期所白银期货，与白银期权标的完全一致',
    hedgeEfficiency: 0.96,
  },
  {
    gridId: 'a-metal',
    optionId: 'opt-cu',
    correlation: 0.85,
    basisRisk: 'medium',
    basisDescription: 'ETF跟踪有色金属期货指数（含铜铝锌铅镍锡），铜期权为单一品种近似对冲',
    hedgeEfficiency: 0.80,
  },
];

// 查找配对关系
export function findCrossPair(
  gridId: string | null,
  optionId: string | null
): CrossPairConfig | null {
  if (!gridId || !optionId) return null;
  return crossPairs.find(
    (pair) => pair.gridId === gridId && pair.optionId === optionId
  ) ?? null;
}
