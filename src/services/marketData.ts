// 市场数据服务层 - 从后端 API 获取实时行情

// 部署时设置 VITE_API_BASE 环境变量指向后端 URL
// 开发时使用空字符串，由 Vite proxy 转发到 localhost:8000
const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
const FETCH_TIMEOUT = 4000; // 4秒超时

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
}

export interface GridProductResponse extends LiveSnapshot {
  market: string;
}

export interface OptionProductResponse extends LiveSnapshot {
  ak_name?: string;
  note?: string;
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

/**
 * 获取所有 ETF 网格品种及实时价格
 */
export async function fetchGridProducts(): Promise<GridProductsResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const resp = await fetch(`${API_BASE}/grid-products`, {
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 获取单个 ETF 品种的实时快照
 */
export async function fetchGridSnapshot(id: string): Promise<LiveSnapshot | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const resp = await fetch(`${API_BASE}/grid-products/${id}/snapshot`, {
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 获取所有期权品种列表
 */
export async function fetchOptionProducts(): Promise<OptionProductsResponse | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const resp = await fetch(`${API_BASE}/option-products`, {
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 健康检查
 */
export async function checkHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const resp = await fetch(`${API_BASE}/health`, {
      signal: controller.signal,
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
