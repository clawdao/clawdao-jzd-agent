/**
 * 觉知岛 API 客户端
 * 基于 ddn-hub-mcp 的 client.mjs 封装，提供统一的 API 调用能力
 */

const USER_AGENT = '@juezhidao/jzd-ops/0.1.0';
const DEFAULT_BASE_URL = 'https://ddn.net';
const DEFAULT_TIMEOUT_MS = 30000;

const trimToUndefined = (value) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeBaseUrl = (value) => {
  const rawValue = trimToUndefined(value);
  const baseUrl = rawValue || DEFAULT_BASE_URL;
  try {
    const normalized = new URL(baseUrl);
    normalized.pathname = normalized.pathname.replace(/\/+$/, '') || '/';
    return {
      baseUrl: normalized.toString().replace(/\/$/, ''),
      baseUrlValid: true,
      baseUrlError: null,
    };
  } catch (error) {
    return {
      baseUrl,
      baseUrlValid: false,
      baseUrlError: error instanceof Error ? error.message : String(error),
    };
  }
};

const createTimeoutController = (timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
};

const appendQuery = (url, query = {}) => {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
      continue;
    }
    url.searchParams.set(key, String(value));
  }
};

const extractMessage = (body, fallback) => {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const candidates = [body.msg, body.message, body.error];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length > 0) return c.trim();
    }
  }
  return fallback;
};

const extractData = (body) => {
  if (body && typeof body === 'object' && !Array.isArray(body) && 'data' in body) return body.data;
  return body;
};

const parseResponseBody = async (response) => {
  const text = await response.text();
  if (!text) return { text: '', body: null };
  try { return { text, body: JSON.parse(text) }; }
  catch { return { text, body: null }; }
};

const buildHeaders = (opts) => {
  const headers = {
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
  };
  if (opts.jsonBody) headers['Content-Type'] = 'application/json';
  if (opts.authToken) headers.Authorization = `Bearer ${opts.authToken}`;
  if (opts.daoId) {
    headers['X-Dao-Id'] = opts.daoId;
    headers['x-dao-id'] = opts.daoId;
  }
  return headers;
};

export class JzdClient {
  #config;

  constructor(config = {}) {
    const baseUrlState = normalizeBaseUrl(config.baseUrl || process.env.DDN_HUB_BASE_URL);
    this.#config = {
      ...baseUrlState,
      authToken: trimToUndefined(config.authToken || process.env.DDN_HUB_AUTH_TOKEN) || null,
      daoId: trimToUndefined(config.daoId || process.env.DDN_HUB_DAO_ID) || null,
      timeoutMs: config.timeoutMs || DEFAULT_TIMEOUT_MS,
    };
  }

  getConfig() {
    return { ...this.#config };
  }

  getRuntimeSnapshot() {
    const c = this.#config;
    return {
      baseUrl: c.baseUrl,
      baseUrlValid: c.baseUrlValid,
      timeoutMs: c.timeoutMs,
      hasAuthToken: Boolean(c.authToken),
      hasDaoId: Boolean(c.daoId),
      daoId: c.daoId,
    };
  }

  async request({ method, path, query, body, authRequired = false, daoRequired = false, daoId }) {
    if (!this.#config.baseUrlValid) {
      return this.#fail('config_error', `DDN_HUB_BASE_URL 无效: ${this.#config.baseUrlError}`);
    }

    const resolvedDaoId = trimToUndefined(daoId) || this.#config.daoId;

    if (authRequired && !this.#config.authToken) {
      return this.#fail('config_error', '需要 DDN_HUB_AUTH_TOKEN 才能调用此工具');
    }

    if (daoRequired && !resolvedDaoId) {
      return this.#fail('config_error', '需要 DDN_HUB_DAO_ID 才能调用此工具');
    }

    const url = new URL(path, this.#config.baseUrl);
    appendQuery(url, query);

    const { signal, cleanup } = createTimeoutController(this.#config.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: buildHeaders({
          authToken: this.#config.authToken,
          daoId: resolvedDaoId,
          jsonBody: body !== undefined,
        }),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });

      const parsed = await parseResponseBody(response);
      const message = extractMessage(
        parsed.body,
        response.ok ? '请求成功' : `请求失败，状态码 ${response.status}`
      );
      const data = extractData(parsed.body);

      if (!response.ok) {
        return this.#fail('http_error', message, response.status, data, parsed.body || parsed.text);
      }

      // 后端业务错误检测（status: 1）
      if (parsed.body && typeof parsed.body === 'object' && parsed.body.status === 1) {
        return this.#fail('business_error', message, response.status, data, parsed.body);
      }

      return { ok: true, statusCode: response.status, message, data };
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      return this.#fail(
        aborted ? 'timeout' : 'network_error',
        aborted ? `请求超时 (${this.#config.timeoutMs}ms)` : (error instanceof Error ? error.message : String(error))
      );
    } finally {
      cleanup();
    }
  }

  #fail(kind, message, statusCode = null, data = null, raw = null) {
    return {
      ok: false,
      statusCode,
      message,
      data,
      error: { kind, message, statusCode },
    };
  }

  // ===== 文章/内容操作 =====

  /** 获取文章列表 */
  async listPosts(params = {}) {
    return this.request({
      method: 'GET',
      path: '/api/v1/posts',
      query: params,
    });
  }

  /** 获取文章详情 */
  async getPost(postId) {
    return this.request({
      method: 'GET',
      path: `/api/v1/posts/${postId}`,
    });
  }

  /** 创建文章 */
  async createPost(body) {
    return this.request({
      method: 'POST',
      path: '/api/v1/posts',
      authRequired: true,
      daoRequired: true,
      body,
    });
  }

  /** 更新文章 */
  async updatePost(postId, body) {
    return this.request({
      method: 'PUT',
      path: `/api/v1/posts/${postId}`,
      authRequired: true,
      daoRequired: true,
      body,
    });
  }

  /** 发布文章 */
  async publishPost(postId, daoId) {
    return this.request({
      method: 'POST',
      path: `/api/v1/posts/${postId}/publish`,
      authRequired: true,
      daoRequired: true,
      daoId,
    });
  }

  /** 删除文章 */
  async deletePost(postId) {
    return this.request({
      method: 'DELETE',
      path: `/api/v1/posts/${postId}`,
      authRequired: true,
      daoRequired: true,
    });
  }

  // ===== 用户投稿操作 =====

  /** 获取用户投稿列表 */
  async listUserContributions(params = {}) {
    return this.request({
      method: 'GET',
      path: '/api/v1/cms/user/posts',
      authRequired: true,
      daoRequired: true,
      query: params,
    });
  }

  /** 创建投稿 */
  async createContribution(postId, body = {}) {
    return this.request({
      method: 'POST',
      path: `/api/v1/cms/user/posts/${postId}/contributions`,
      authRequired: true,
      daoRequired: true,
      body,
    });
  }

  // ===== 课程操作 =====

  /** 获取已发布课程列表 */
  async listPublishedCourses(params = {}) {
    return this.request({
      method: 'GET',
      path: '/api/v1/course/courses/published',
      query: params,
    });
  }

  /** 获取课程列表（管理端） */
  async listCourses(params = {}) {
    return this.request({
      method: 'GET',
      path: '/api/v1/course/courses',
      authRequired: true,
      daoRequired: true,
      query: params,
    });
  }

  /** 获取课程详情 */
  async getCourse(courseId) {
    return this.request({
      method: 'GET',
      path: `/api/v1/course/courses/${courseId}`,
    });
  }

  /** 创建课程 */
  async createCourse(body) {
    return this.request({
      method: 'POST',
      path: '/api/v1/course/courses',
      authRequired: true,
      daoRequired: true,
      body,
    });
  }

  /** 更新课程 */
  async updateCourse(courseId, body) {
    return this.request({
      method: 'PUT',
      path: `/api/v1/course/courses/${courseId}`,
      authRequired: true,
      daoRequired: true,
      body,
    });
  }

  /** 删除课程 */
  async deleteCourse(courseId) {
    return this.request({
      method: 'DELETE',
      path: `/api/v1/course/courses/${courseId}`,
      authRequired: true,
      daoRequired: true,
    });
  }

  /** 更新课程状态 */
  async updateCourseStatus(courseId, status) {
    return this.request({
      method: 'PUT',
      path: `/api/v1/course/courses/${courseId}/status`,
      authRequired: true,
      daoRequired: true,
      body: { status },
    });
  }

  // ===== 课程分类操作 =====

  /** 获取课程分类列表 */
  async listCourseCategories(params = {}) {
    return this.request({
      method: 'GET',
      path: '/api/v1/course/categories',
      query: params,
    });
  }

  /** 创建课程分类 */
  async createCourseCategory(body) {
    return this.request({
      method: 'POST',
      path: '/api/v1/course/categories',
      authRequired: true,
      daoRequired: true,
      body,
    });
  }

  // ===== 课程评价操作 =====

  /** 获取课程评价列表 */
  async listCourseReviews(params = {}) {
    return this.request({
      method: 'GET',
      path: '/api/v1/course/reviews',
      query: params,
    });
  }

  /** 创建课程评价 */
  async createCourseReview(body) {
    return this.request({
      method: 'POST',
      path: '/api/v1/course/reviews',
      authRequired: true,
      body,
    });
  }

  // ===== 系统/通用操作 =====

  /** 健康检查 */
  async healthCheck() {
    return this.request({ method: 'GET', path: '/api/health' });
  }

  /** 获取系统配置 */
  async getPublicConfig() {
    return this.request({ method: 'GET', path: '/api/v1/public/config' });
  }
}
