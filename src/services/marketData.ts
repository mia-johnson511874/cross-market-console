// 市场数据服务层
// 优先从后端 API 获取实时行情，后端不可用时使用内置模拟数据

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
const FETCH_TIMEOUT = 15000;

// ============ 内置模拟实时数据 ============

// 基础价格表 (与 gridProducts.ts 保持一致)
const BASE_PRICES: Record<string, { price: number; name: string }> = {
  'a-50etf':   { price: 2.85,  name: '上证50ETF' },
  'a-300etf':  { price: 4.05,  name: '沪深300ETF(沪)' },
  'a-300etf-sz': { price: 4.08,  name: '沪深300ETF(深)' },
  'a-500etf':  { price: 5.95,  name: '中证500ETF' },
  'a-kc50':    { price: 1.12,  name: '科创50ETF' },
  'a-hstech':  { price: 0.580, name: '恒生科技ETF' },
  'a-hsient':  { price: 0.420, name: '恒生互联网ETF' },
  'a-hsient2': { price: 1.150, name: '中概互联ETF' },
  'a-hsi':     { price: 1.250, name: '恒生ETF' },
  'a-hsi2':    { price: 0.880, name: 'H股ETF' },
  'a-hkstock50': { price: 0.960, name: '港股通50ETF' },
  'a-hkfinance': { price: 1.080, name: '港股通金融ETF' },
  'a-hstech2': { price: 0.540, name: '恒生科技指数ETF' },
  'a-nasdaq':  { price: 1.850, name: '纳指ETF' },
  'a-sp500':   { price: 2.100, name: '标普500ETF' },
  'a-nasdaq2': { price: 1.820, name: '纳指ETF深' },
  'a-nasdaq100': { price: 1.560, name: '纳斯达克100ETF' },
  'a-nasdaq3': { price: 1.580, name: '纳斯达克ETF沪' },
  'a-nikkei':  { price: 1.420, name: '日经ETF' },
  'a-germany': { price: 1.380, name: '德国ETF' },
  'a-gold':    { price: 5.85,  name: '黄金ETF' },
  'a-gold2':   { price: 5.82,  name: '黄金ETF深' },
  'a-doupo':   { price: 1.95,  name: '豆粕ETF' },
  'a-silver':  { price: 0.92,  name: '白银LOF' },
  'a-metal':   { price: 1.65,  name: '有色金属ETF' },
};

/** 基于 ID + 时间窗口 生成确定性"随机"数 (每30秒变化一次) */
function pseudoRandom(id: string): number {
  const bucket = Math.floor(Date.now() / 30000);
  const seed = id.length * 31 + bucket * 7;
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function generateSimulatedSnapshot(id: string): LiveSnapshot {
  const base = BASE_PRICES[id];
  if (!base) return { id, code: id, name: id, live_price: null, prev_close: null, change_pct: null };

  const rng = pseudoRandom(id);
  const changePct = (rng - 0.5) * 4; // -2% ~ +2%
  const livePrice = base.price * (1 + changePct / 100);

  return {
    id,
    code: id,
    name: base.name,
    live_price: Math.round(livePrice * 1000) / 1000,
    prev_close: base.price,
    change_pct: Math.round(changePct * 100) / 100,
    high: Math.round(livePrice * (1 + Math.abs(changePct) / 200) * 1000) / 1000,
    low: Math.round(livePrice * (1 - Math.abs(changePct) / 200) * 1000) / 1000,
    volume: Math.floor(rng * 100000000),
    simulated: true,
    source: 'frontend_simulated',
  };
}

// ============ 类型 ============

export interface LiveSnapshot {
  id: string;
  code: string;
  name: string;
  live_price: number | null;
  prev_close: number | null;
  change_pct: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  error?: string | null;
  simulated?: boolean;
  source?: string;
}

export interface GridProductResponse extends LiveSnapshot {
  market: string;
}

export interface GridProductsResponse {
  products: GridProductResponse[];
  count: number;
  elapsed_ms: number;
}

export interface OptionProductsResponse {
  products: OptionProductResponse[];
  count: number;
}

export interface OptionProductResponse extends LiveSnapshot {
  ak_name?: string;
  note?: string;
}

// ============ API 调用 (优先真实 API，失败回退模拟数据) ============

export async function fetchGridProducts(): Promise<GridProductsResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const resp = await fetch(`${API_BASE}/grid-products`, { signal: controller.signal });
    if (resp.ok) return await resp.json();
  } catch { /* fallback */ } finally {
    clearTimeout(timeoutId);
  }

  // 后端不可用，生成模拟数据
  const ids = Object.keys(BASE_PRICES);
  return {
    products: ids.map(id => ({
      ...generateSimulatedSnapshot(id),
      market: '1',
    })),
    count: ids.length,
    elapsed_ms: 10,
  };
}

export async function fetchGridSnapshot(id: string): Promise<LiveSnapshot | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 延长超时，避免缓存失效时过早降级

  try {
    const resp = await fetch(`${API_BASE}/grid-products/${id}/snapshot`, { signal: controller.signal });
    if (resp.ok) return await resp.json();
  } catch { /* fallback */ } finally {
    clearTimeout(timeoutId);
  }

  // 后端不可用，生成模拟数据
  return generateSimulatedSnapshot(id);
}

export async function fetchOptionProducts(): Promise<OptionProductsResponse | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const resp = await fetch(`${API_BASE}/option-products`, { signal: controller.signal });
    if (resp.ok) return await resp.json();
  } catch { /* fallback */ } finally {
    clearTimeout(timeoutId);
  }
  return null;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${API_BASE}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    return resp.ok;
  } catch {
    return false;
  }
}

// ============ 数据源诊断 ============

export interface DataSourceStatus {
  available: boolean;
  latency_ms: number;
}

export interface DataSourcesResponse {
  sources: Record<string, DataSourceStatus>;
  any_real_data: boolean;
  mode: 'live' | 'simulated';
  checked_at: string;
}

export interface OptionChainContract {
  code: string;
  name: string;
  strike: number;
  expiry: string;
  type: string;
  latest_price: number | null;
  volume: number | null;
  open_interest: number | null;
  change_pct: number | null;
}

export interface OptionChainResponse {
  underlying_code: string;
  underlying_name: string;
  expiry_months: string[];
  contracts: OptionChainContract[];
  source?: string;
  simulated?: boolean;
}

export async function fetchOptionChain(underlying: string): Promise<OptionChainResponse | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const resp = await fetch(`${API_BASE}/option-chain/${encodeURIComponent(underlying)}`, { signal: controller.signal });
    if (resp.ok) return await resp.json();
  } catch { /* fallback */ } finally {
    clearTimeout(timeoutId);
  }
  return null;
}

export async function fetchDataSources(): Promise<DataSourcesResponse | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(`${API_BASE}/data-sources`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (resp.ok) return await resp.json();
  } catch { /* backend not available */ }
  return null;
}
