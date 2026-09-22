import axios from 'axios';
import type { SearchResponse, LinkCheckItem, LinkCheckResponse } from '@/types';

// 超时分层（外层必须大于内层，否则外层先杀）：
//   引擎 TG 单频道 4s abort → TG 整体 5s（部分结果）→ 插件快窗 4s →
//   引擎请求安全网 7s（降级空响应）→ 本层 axios 10s → shell DisksProvider 8s →
//   nginx /disks/api proxy_read_timeout 60s。引擎最坏 7s 内必响应，10s 只剩网络余量。
const api = axios.create({
  baseURL: '/api',
  timeout: 10000
});

// 请求拦截器 - 自动添加token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器 - 处理401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // 清除token
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_username');
      
      // 触发显示登录窗口的事件
      window.dispatchEvent(new CustomEvent('auth:required'));
    }
    return Promise.reject(error);
  }
);

// 搜索参数接口
export interface SearchParams {
  kw: string;
  refresh?: boolean;
  res?: 'all' | 'results' | 'merge';
  src?: 'all' | 'tg' | 'plugin';
  plugins?: string;
  channels?: string;
  cloud_types?: string;
  ext?: string;
}

// API响应包装类型
interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/**
 * 统一解包（D10 兼容层）：引擎各端点响应形态不一致——
 * 有的裸 data（如 /health、/api/check/links 早期约定），有的 {code,message,data} 包装。
 * - 有 code 字段且 code !== 0 → 视为业务失败，抛错（失败绝不能被当成功消费）
 * - 有 data 字段 → 返回 data
 * - 否则原样返回（裸 data 形态）
 */
function unwrap<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'code' in (body as Record<string, unknown>)) {
    const { code, message, data } = body as ApiResponse<T>;
    if (typeof code === 'number' && code !== 0) {
      throw new Error(message || `请求失败 (code=${code})`);
    }
    if (data !== undefined) return data;
  }
  return body as T;
}

// 健康状态接口（基于实际API返回）
export interface HealthStatus {
  status: string;
  plugins_enabled: boolean;
  plugin_count: number;
  plugins: string[];
  channels: string[];
  auth_enabled?: boolean;
}

// 登录请求参数
export interface LoginParams {
  username: string;
  password: string;
}

// 登录响应
export interface LoginResponse {
  token: string;
  expires_at: number;
  username: string;
}

// 认证状态
export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
}

// 获取API健康状态
export const getHealth = async (): Promise<HealthStatus> => {
  const response = await api.get<HealthStatus>('/health');
  return response.data;
};

// 搜索API
export const search = async (params: SearchParams): Promise<SearchResponse> => {
  // 添加ext参数，包含referer信息
  const searchParams = {
    ...params,
    ext: JSON.stringify({ referer: "https://dm.xueximeng.com" })
  };

  const response = await api.get<unknown>('/search', { params: searchParams });
  const body = unwrap<SearchResponse | Partial<SearchResponse>>(response.data);

  // 如果响应本身就是SearchResponse格式（裸 data 形态）
  if (body && body.total !== undefined && body.merged_by_type) {
    return body as SearchResponse;
  }

  // 返回空结果
  return {
    total: 0,
    results: [],
    merged_by_type: {}
  };
};

// 登录
export const login = async (params: LoginParams): Promise<LoginResponse> => {
  const response = await api.post<unknown>('/auth/login', params);
  // 引擎失败时也可能返回 HTTP 200 {code:1001}（旧版行为），必须校验 code，
  // 绝不能把失败响应里的 undefined token 当登录成功写进 localStorage
  const data = unwrap<LoginResponse>(response.data);
  if (!data || typeof data.token !== 'string' || data.token === '') {
    throw new Error('登录响应缺少凭证');
  }
  return data;
};

// 验证token
export const verifyToken = async (): Promise<boolean> => {
  try {
    // 引擎对无效 token 返回 HTTP 200 {code:1002}，必须解包判断 code 而非只看 HTTP 状态
    const response = await api.post<unknown>('/auth/verify');
    const data = unwrap<{ valid?: boolean }>(response.data);
    return data?.valid === true;
  } catch {
    return false;
  }
};

// 退出登录
export const logout = async (): Promise<void> => {
  try {
    await api.post('/auth/logout');
  } finally {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_username');
  }
};

export const inspectVisibleLinks = async (
  items: LinkCheckItem[],
  view_token?: string
): Promise<LinkCheckResponse> => {
  const response = await api.post<unknown>('/check/links', {
    items,
    view_token
  });
  // 兼容两种响应形态（{code,message,data} 包装 / 裸 data），统一返回业务数据
  return unwrap<LinkCheckResponse>(response.data);
};

// 检查认证状态
export const checkAuthStatus = async (): Promise<AuthStatus> => {
  try {
    const health = await getHealth();
    const authEnabled = health.auth_enabled || false;
    const token = localStorage.getItem('auth_token');
    
    if (!authEnabled) {
      return { enabled: false, authenticated: true };
    }
    
    if (!token) {
      return { enabled: true, authenticated: false };
    }
    
    const valid = await verifyToken();
    return { enabled: true, authenticated: valid };
  } catch {
    return { enabled: false, authenticated: true };
  }
};

export default api; 
