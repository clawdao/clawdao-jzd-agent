/**
 * 应用市场操作模块 - 觉知岛应用市场管理
 * 提供资产列表、统计、上架、编辑、状态管理等能力
 *
 * 接口对应 ddn-hub 的 marketplace 模块：
 *   公开：GET /api/v1/marketplace/asset[/featured|/categories|/:uuid]
 *   管理：GET|POST /api/v1/marketplace/admin/asset
 *         PUT|DELETE /api/v1/marketplace/admin/asset/:uuid
 *         PUT /api/v1/marketplace/admin/asset/:uuid/status
 *         PUT /api/v1/marketplace/admin/asset/:uuid/featured
 */

import { JzdClient } from './client.mjs';

/** 资产类型（与 ddn-hub contract 一致） */
export const ASSET_TYPES = ['app', 'skill', 'mcp', 'prompt', 'employee', 'plugin', 'template'];
export const ASSET_TYPE_LABELS = {
  app: '应用',
  skill: '技能',
  mcp: 'MCP',
  prompt: '提示词',
  employee: '数字员工',
  plugin: '插件',
  template: '模板',
};
export const ASSET_STATUSES = ['draft', 'active', 'inactive', 'archived'];
export const PRICE_TYPES = ['free', 'points', 'paid'];
export const PRICE_TYPE_LABELS = { free: '免费', points: '积分', paid: '付费' };

export class MarketplaceManager {
  #client;

  constructor(clientOrConfig) {
    this.#client = clientOrConfig instanceof JzdClient
      ? clientOrConfig
      : new JzdClient(clientOrConfig);
  }

  /**
   * 公开浏览市场资产
   * @param {object} params type/keyword/category/tag/isFeatured/sort/page/pageSize
   */
  async list({ type, keyword, category, tag, isFeatured, sort, page = 1, pageSize = 20 } = {}) {
    const result = await this.#client.request({
      method: 'GET',
      path: '/api/v1/marketplace/asset',
      query: {
        type: type || undefined,
        keyword: keyword || undefined,
        category: category || undefined,
        tag: tag || undefined,
        isFeatured: isFeatured === true || isFeatured === 'true' ? true : undefined,
        sort: sort || undefined,
        page,
        pageSize,
      },
    });
    if (!result.ok) return result;
    const data = result.data || {};
    return {
      ok: true,
      message: result.message,
      items: data.items || [],
      total: data.total || 0,
      page: data.page || page,
      pageSize: data.pageSize || pageSize,
      totalPages: data.totalPages || 0,
    };
  }

  /**
   * 管理端资产列表（含 draft/inactive/archived 所有状态，需鉴权）
   */
  async listAdmin({ type, status, keyword, page = 1, pageSize = 20 } = {}) {
    const result = await this.#client.request({
      method: 'GET',
      path: '/api/v1/marketplace/admin/asset',
      authRequired: true,
      query: {
        type: type || undefined,
        status: status || undefined,
        keyword: keyword || undefined,
        page,
        pageSize,
      },
    });
    if (!result.ok) return result;
    const data = result.data || {};
    return {
      ok: true,
      message: result.message,
      items: data.items || [],
      total: data.total || 0,
      page: data.page || page,
      pageSize: data.pageSize || pageSize,
      totalPages: data.totalPages || 0,
    };
  }

  /**
   * 统计：按类型/状态聚合（管理端，需鉴权）
   */
  async stats() {
    const result = await this.listAdmin({ page: 1, pageSize: 200 });
    if (!result.ok) return result;

    const byType = {};
    const byStatus = {};
    const byTypeStatus = {};
    for (const item of result.items) {
      const t = item.type || 'unknown';
      const s = item.status || 'unknown';
      byType[t] = (byType[t] || 0) + 1;
      byStatus[s] = (byStatus[s] || 0) + 1;
      const key = `${t}:${s}`;
      byTypeStatus[key] = (byTypeStatus[key] || 0) + 1;
    }

    // 若一页装不下，多页拉全
    let allItems = result.items;
    if (result.totalPages > 1) {
      for (let p = 2; p <= result.totalPages; p++) {
        const more = await this.listAdmin({ page: p, pageSize: 200 });
        if (more.ok) allItems = allItems.concat(more.items);
      }
      // 重算
      byType = {}; byStatus = {}; byTypeStatus = {};
      for (const item of allItems) {
        const t = item.type || 'unknown';
        const s = item.status || 'unknown';
        byType[t] = (byType[t] || 0) + 1;
        byStatus[s] = (byStatus[s] || 0) + 1;
        byTypeStatus[`${t}:${s}`] = (byTypeStatus[`${t}:${s}`] || 0) + 1;
      }
    }

    return {
      ok: true,
      message: result.message,
      total: allItems.length,
      byType,
      byStatus,
      byTypeStatus,
      items: allItems,
    };
  }

  /** 资产详情 */
  async get(uuid) {
    if (!uuid) return { ok: false, message: '请提供资产 UUID', error: { kind: 'param_error' } };
    return this.#client.request({
      method: 'GET',
      path: `/api/v1/marketplace/asset/${encodeURIComponent(uuid)}`,
    });
  }

  /** 精选列表 */
  async listFeatured(limit = 6) {
    const result = await this.#client.request({
      method: 'GET',
      path: '/api/v1/marketplace/asset/featured',
      query: { limit },
    });
    if (!result.ok) return result;
    return { ok: true, message: result.message, items: result.data?.items || [] };
  }

  /** 类目聚合 */
  async categories() {
    const result = await this.#client.request({
      method: 'GET',
      path: '/api/v1/marketplace/asset/categories',
    });
    if (!result.ok) return result;
    return { ok: true, message: result.message, items: result.data?.items || [] };
  }

  /** 新建资产（上架新应用，需 canManageSystem） */
  async create(data) {
    const payload = {
      type: data.type,
      slug: data.slug,
      name: data.name,
      ...(data.description && { description: data.description }),
      ...(data.icon && { icon: data.icon }),
      ...(data.tags && { tags: data.tags }),
      ...(data.category && { category: data.category }),
      ...(data.author && { author: data.author }),
      ...(data.version && { version: data.version }),
      ...(data.sourceUrl && { sourceUrl: data.sourceUrl }),
      ...(data.configUrl && { configUrl: data.configUrl }),
      ...(data.priceType && { priceType: data.priceType }),
      ...(data.price !== undefined && { price: data.price }),
      ...(data.pointsCost !== undefined && { pointsCost: data.pointsCost }),
      ...(data.isFeatured !== undefined && { isFeatured: data.isFeatured }),
      ...(data.readme && { readme: data.readme }),
      ...(data.license && { license: data.license }),
    };
    if (!payload.type || !payload.slug || !payload.name) {
      return { ok: false, message: 'type / slug / name 必填', error: { kind: 'param_error' } };
    }
    return this.#client.request({
      method: 'POST',
      path: '/api/v1/marketplace/admin/asset',
      authRequired: true,
      body: payload,
    });
  }

  /** 编辑资产（需 canManageSystem） */
  async update(uuid, data) {
    if (!uuid) return { ok: false, message: '请提供资产 UUID', error: { kind: 'param_error' } };
    const payload = {};
    const fields = [
      'type', 'slug', 'name', 'description', 'icon', 'tags', 'category', 'author',
      'version', 'sourceUrl', 'configUrl', 'priceType', 'price', 'pointsCost', 'isFeatured',
      'readme', 'license',
    ];
    for (const f of fields) {
      if (data[f] !== undefined) payload[f] = data[f];
    }
    if (Object.keys(payload).length === 0) {
      return { ok: false, message: '没有需要更新的字段', error: { kind: 'param_error' } };
    }
    return this.#client.request({
      method: 'PUT',
      path: `/api/v1/marketplace/admin/asset/${encodeURIComponent(uuid)}`,
      authRequired: true,
      body: payload,
    });
  }

  /** 切换状态 draft/active/inactive/archived */
  async updateStatus(uuid, status) {
    if (!uuid) return { ok: false, message: '请提供资产 UUID', error: { kind: 'param_error' } };
    if (!ASSET_STATUSES.includes(status)) {
      return { ok: false, message: `status 必须是: ${ASSET_STATUSES.join(' / ')}`, error: { kind: 'param_error' } };
    }
    return this.#client.request({
      method: 'PUT',
      path: `/api/v1/marketplace/admin/asset/${encodeURIComponent(uuid)}/status`,
      authRequired: true,
      body: { status },
    });
  }

  /** 设置/取消精选 */
  async setFeatured(uuid, isFeatured = true) {
    if (!uuid) return { ok: false, message: '请提供资产 UUID', error: { kind: 'param_error' } };
    return this.#client.request({
      method: 'PUT',
      path: `/api/v1/marketplace/admin/asset/${encodeURIComponent(uuid)}/featured`,
      authRequired: true,
      body: { isFeatured: Boolean(isFeatured) },
    });
  }

  /** 删除资产（仅 draft 可删） */
  async remove(uuid) {
    if (!uuid) return { ok: false, message: '请提供资产 UUID', error: { kind: 'param_error' } };
    return this.#client.request({
      method: 'DELETE',
      path: `/api/v1/marketplace/admin/asset/${encodeURIComponent(uuid)}`,
      authRequired: true,
    });
  }
}
