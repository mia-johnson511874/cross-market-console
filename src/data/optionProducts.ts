// 跨市场策略控制台 - 期权品种配置 (11个)

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface OptionProduct {
  id: string;
  name: string;
  code: string;
  price: number;
  currency: 'CNY' | 'HKD';
  exchange: 'SSE' | 'SZSE' | 'HKEX' | 'SHFE' | 'DCE' | 'CZCE';
  marketType: 'etf-option' | 'index-option' | 'commodity-option';
  strike: number;
  nearCall: number;
  nearPut: number;
  farCall: number;
  farPut: number;
  daysNear: number;
  daysFar: number;
  greeks: Greeks;
  pointValue: number;
  contractUnit?: string;
  marginRate?: number;
  exerciseType?: 'european' | 'american';
  pairedGrid?: {
    gridId: string;
    correlation: number;
    basisRisk: 'low' | 'medium' | 'high';
    note: string;
  };
}

export const optionProducts: OptionProduct[] = [
  // ===== A股 ETF期权 (5个) =====
  {
    id: 'opt-50',
    name: '上证50ETF期权',
    code: '510050',
    price: 2.85,
    currency: 'CNY',
    exchange: 'SSE',
    marketType: 'etf-option',
    strike: 2.85,
    nearCall: 0.0850,
    nearPut: 0.0780,
    farCall: 0.1500,
    farPut: 0.1350,
    daysNear: 14,
    daysFar: 42,
    greeks: { delta: 0.02, gamma: -12.5, theta: 28.0, vega: 15.0 },
    pointValue: 10000,
    contractUnit: '10000份/张',
    exerciseType: 'european',
  },
  {
    id: 'opt-300',
    name: '沪深300ETF期权(沪)',
    code: '510300',
    price: 4.05,
    currency: 'CNY',
    exchange: 'SSE',
    marketType: 'etf-option',
    strike: 4.00,
    nearCall: 0.1200,
    nearPut: 0.0950,
    farCall: 0.2100,
    farPut: 0.1750,
    daysNear: 14,
    daysFar: 42,
    greeks: { delta: 0.05, gamma: -10.0, theta: 35.0, vega: 20.0 },
    pointValue: 10000,
    contractUnit: '10000份/张',
    exerciseType: 'european',
  },
  {
    id: 'opt-300sz',
    name: '沪深300ETF期权(深)',
    code: '159919',
    price: 4.08,
    currency: 'CNY',
    exchange: 'SZSE',
    marketType: 'etf-option',
    strike: 4.10,
    nearCall: 0.1100,
    nearPut: 0.1050,
    farCall: 0.2000,
    farPut: 0.1850,
    daysNear: 14,
    daysFar: 42,
    greeks: { delta: -0.01, gamma: -11.0, theta: 33.0, vega: 18.0 },
    pointValue: 10000,
    contractUnit: '10000份/张',
    exerciseType: 'european',
  },
  {
    id: 'opt-500',
    name: '中证500ETF期权',
    code: '510500',
    price: 5.95,
    currency: 'CNY',
    exchange: 'SSE',
    marketType: 'etf-option',
    strike: 6.00,
    nearCall: 0.1600,
    nearPut: 0.1850,
    farCall: 0.2800,
    farPut: 0.3200,
    daysNear: 14,
    daysFar: 42,
    greeks: { delta: -0.05, gamma: -13.0, theta: 42.0, vega: 25.0 },
    pointValue: 10000,
    contractUnit: '10000份/张',
    exerciseType: 'european',
  },
  {
    id: 'opt-kc50',
    name: '科创50ETF期权',
    code: '588000',
    price: 1.12,
    currency: 'CNY',
    exchange: 'SSE',
    marketType: 'etf-option',
    strike: 1.10,
    nearCall: 0.0450,
    nearPut: 0.0350,
    farCall: 0.0800,
    farPut: 0.0650,
    daysNear: 14,
    daysFar: 42,
    greeks: { delta: 0.03, gamma: -9.0, theta: 18.0, vega: 8.0 },
    pointValue: 10000,
    contractUnit: '10000份/张',
    exerciseType: 'european',
  },

  // ===== 港股 指数期权 (1个) =====
  {
    id: 'opt-hstech',
    name: '恒生科技指数期权',
    code: 'HSI',
    price: 5200,
    currency: 'HKD',
    exchange: 'HKEX',
    marketType: 'index-option',
    strike: 5200,
    nearCall: 180,
    nearPut: 165,
    farCall: 320,
    farPut: 290,
    daysNear: 14,
    daysFar: 42,
    greeks: { delta: 0.04, gamma: -8.0, theta: 55.0, vega: 30.0 },
    pointValue: 50,
    contractUnit: '50港元/点',
    exerciseType: 'european',
  },

  // ===== 商品期货期权 (5个) =====
  {
    id: 'opt-au',
    name: '黄金期权',
    code: 'AU',
    price: 590,
    currency: 'CNY',
    exchange: 'SHFE',
    marketType: 'commodity-option',
    strike: 592,
    nearCall: 12.50,
    nearPut: 14.00,
    farCall: 22.00,
    farPut: 24.50,
    daysNear: 20,
    daysFar: 55,
    greeks: { delta: -0.02, gamma: -15.0, theta: 8.5, vega: 6.0 },
    pointValue: 1000,
    contractUnit: '1000克/手',
    marginRate: 0.08,
    exerciseType: 'american',
    pairedGrid: {
      gridId: 'a-gold',
      correlation: 0.95,
      basisRisk: 'medium',
      note: 'ETF跟踪现货Au99.99，期权行权后获得黄金期货合约，存在期限结构差异',
    },
  },
  {
    id: 'opt-ag',
    name: '白银期权',
    code: 'AG',
    price: 7800,
    currency: 'CNY',
    exchange: 'SHFE',
    marketType: 'commodity-option',
    strike: 7800,
    nearCall: 180,
    nearPut: 195,
    farCall: 320,
    farPut: 350,
    daysNear: 20,
    daysFar: 55,
    greeks: { delta: -0.03, gamma: -14.0, theta: 12.0, vega: 8.0 },
    pointValue: 15,
    contractUnit: '15千克/手',
    marginRate: 0.10,
    exerciseType: 'american',
    pairedGrid: {
      gridId: 'a-silver',
      correlation: 0.98,
      basisRisk: 'low',
      note: '白银LOF跟踪上期所白银期货，与白银期权标的一致',
    },
  },
  {
    id: 'opt-cu',
    name: '铜期权',
    code: 'CU',
    price: 78200,
    currency: 'CNY',
    exchange: 'SHFE',
    marketType: 'commodity-option',
    strike: 78000,
    nearCall: 1800,
    nearPut: 1700,
    farCall: 3200,
    farPut: 3100,
    daysNear: 20,
    daysFar: 55,
    greeks: { delta: 0.02, gamma: -18.0, theta: 25.0, vega: 15.0 },
    pointValue: 5,
    contractUnit: '5吨/手',
    marginRate: 0.10,
    exerciseType: 'american',
    pairedGrid: {
      gridId: 'a-metal',
      correlation: 0.85,
      basisRisk: 'medium',
      note: 'ETF跟踪有色金属期货指数（含多品种），铜期权为单一品种近似对冲',
    },
  },
  {
    id: 'opt-m',
    name: '豆粕期权',
    code: 'M',
    price: 3280,
    currency: 'CNY',
    exchange: 'DCE',
    marketType: 'commodity-option',
    strike: 3300,
    nearCall: 85,
    nearPut: 95,
    farCall: 150,
    farPut: 165,
    daysNear: 20,
    daysFar: 55,
    greeks: { delta: -0.04, gamma: -12.0, theta: 6.5, vega: 4.0 },
    pointValue: 10,
    contractUnit: '10吨/手',
    marginRate: 0.08,
    exerciseType: 'american',
    pairedGrid: {
      gridId: 'a-doupo',
      correlation: 0.98,
      basisRisk: 'low',
      note: '豆粕ETF跟踪豆粕期货价格指数，与豆粕期权标的几乎一致',
    },
  },
  {
    id: 'opt-rb',
    name: '螺纹钢期权',
    code: 'RB',
    price: 3650,
    currency: 'CNY',
    exchange: 'SHFE',
    marketType: 'commodity-option',
    strike: 3650,
    nearCall: 90,
    nearPut: 88,
    farCall: 160,
    farPut: 155,
    daysNear: 20,
    daysFar: 55,
    greeks: { delta: 0.01, gamma: -10.0, theta: 7.0, vega: 5.0 },
    pointValue: 10,
    contractUnit: '10吨/手',
    marginRate: 0.10,
    exerciseType: 'american',
  },
];

export const marketTypeLabels: Record<OptionProduct['marketType'], string> = {
  'etf-option': 'ETF期权',
  'index-option': '指数期权',
  'commodity-option': '商品期货期权',
};
