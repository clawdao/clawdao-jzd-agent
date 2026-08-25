/**
 * 产品版本发布模块 - 觉知岛 DDN Hub 产品版本管理
 *
 * 接口对应 ddn-hub 的 product 模块：
 *   GET    /api/v1/product/versions                       列表
 *   GET    /api/v1/product/versions/:id                   详情
 *   POST   /api/v1/product/versions                       创建版本
 *   PUT    /api/v1/product/versions/:id                   更新
 *   DELETE /api/v1/product/versions/:id                   软删
 *   DELETE /api/v1/product/versions/:id/force             硬删
 *   POST   /api/v1/product/versions/:id/assets/confirm    确认 assets
 *   POST   /api/v1/product/versions/:id/deprecate         弃用版本
 *   POST   /api/v1/product/versions/:id/generate-manifest 生成 manifest
 *   GET    /api/v1/product/versions/:id/manifest/preview  manifest 预览
 *   POST   /api/v1/product/versions/:id/publish           发布（手动模式）
 *   GET    /api/v1/product/versions/download-summary      摘要（按 productKey）
 *
 *   POST   /api/v1/product/download-assets/sync-from-s3   从 S3 同步资产（核心）
 *   POST   /api/v1/product/download-assets/presigned-upload  预签名上传
 *   GET    /api/v1/product/download-assets/health         健康检查
 *   GET    /api/v1/product/packages                       软件包列表
 */

import { JzdClient } from './client.mjs';

/** 常见 product catalog UUID（可在 CLI 用 --product-id 覆盖） */
export const KNOWN_PRODUCT_IDS = {
  clawdao: '11111111-1111-1111-1111-111111111111',
  limschain: '33333333-3333-3333-3333-333333333333',
  ddn: '44444444-4444-4444-4444-444444444444',
  'ddn-ubl': '55555555-5555-5555-5555-555555555555',
};

/** 默认 releaseNotes 结构（多语言 HTML 字符串数组） */
export const emptyReleaseNotes = () => ({ zh: [], en: [] });

/** 把一段 HTML 段落塞进 releaseNotes.zh */
export const buildZhNotes = (htmlOrArray) => {
  if (Array.isArray(htmlOrArray)) return htmlOrArray.filter(Boolean);
  if (typeof htmlOrArray === 'string' && htmlOrArray.trim()) return [htmlOrArray];
  return [];
};

export class VersionManager {
  #client;

  constructor(clientOrConfig) {
    this.#client = clientOrConfig instanceof JzdClient
      ? clientOrConfig
      : new JzdClient(clientOrConfig);
  }

  /**
   * 列出某产品下所有版本（按 productId 过滤；支持 status/releaseSource 等过滤）
   */
  async list({ productId, productKey, status, releaseSource, isPrerelease, page = 1, pageSize = 20 } = {}) {
    // 兼容 productKey → productId（如果传 slug）
    const resolvedId = productId || (productKey && KNOWN_PRODUCT_IDS[productKey]) || undefined;
    const result = await this.#client.request({
      method: 'GET',
      path: '/api/v1/product/versions',
      query: {
        productId: resolvedId,
        productKey: productKey && !resolvedId ? productKey : undefined,
        status: status || undefined,
        releaseSource: releaseSource || undefined,
        isPrerelease: isPrerelease === true || isPrerelease === 'true' ? true : undefined,
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

  /** 获取版本详情 */
  async get(versionId) {
    return this.#client.request({
      method: 'GET',
      path: `/api/v1/product/versions/${versionId}`,
    });
  }

  /**
   * 创建版本（核心：整理字段 + 更新说明 + POST）
   * @param {object} body
   *   productId     {string}  产品 catalog UUID（必填）
   *   version       {string}  semver，如 "1.0.27"（必填）
   *   releaseNotes  {object}  { zh: [htmlString], en: [htmlString] }
   *   releaseAt     {string}  ISO 时间，可选
   *   isLatest      {boolean} 是否最新版本（默认 true）
   *   isPrerelease  {boolean} 是否预发布（默认 false）
   *   sortOrder     {number}  可选排序
   *   metadata      {object}  自定义元数据
   */
  async create(body) {
    if (!body || !body.productId) {
      return { ok: false, error: { kind: 'validation', message: 'productId 必填（可用 KNOWN_PRODUCT_IDS[productKey] 或 --product-id）' } };
    }
    if (!body.version) {
      return { ok: false, error: { kind: 'validation', message: 'version 必填（semver，如 1.0.27）' } };
    }
    const payload = {
      productId: body.productId,
      version: body.version,
      releaseNotes: body.releaseNotes || emptyReleaseNotes(),
      releaseAt: body.releaseAt || new Date().toISOString(),
      isLatest: body.isLatest !== false,
      isPrerelease: body.isPrerelease === true,
      sortOrder: body.sortOrder ?? 0,
      releaseSource: body.releaseSource || 'manual',
      metadata: body.metadata || {},
      ...(body.title ? { title: body.title } : {}),
      ...(body.commitSha ? { commitSha: body.commitSha } : {}),
      ...(body.gitlabTagName ? { gitlabTagName: body.gitlabTagName } : {}),
    };
    return this.#client.request({
      method: 'POST',
      path: '/api/v1/product/versions',
      authRequired: true,
      body: payload,
    });
  }

  /** 更新版本 */
  async update(versionId, body) {
    return this.#client.request({
      method: 'PUT',
      path: `/api/v1/product/versions/${versionId}`,
      authRequired: true,
      body,
    });
  }

  /** 软删版本 */
  async remove(versionId) {
    return this.#client.request({
      method: 'DELETE',
      path: `/api/v1/product/versions/${versionId}`,
      authRequired: true,
    });
  }

  /** 硬删版本（不可恢复） */
  async removeForce(versionId) {
    return this.#client.request({
      method: 'DELETE',
      path: `/api/v1/product/versions/${versionId}/force`,
      authRequired: true,
    });
  }

  /** 确认版本关联的 assets（body 必传 asset 列表） */
  async confirmAssets(versionId, assets) {
    return this.#client.request({
      method: 'POST',
      path: `/api/v1/product/versions/${versionId}/assets/confirm`,
      authRequired: true,
      body: assets,
    });
  }

  /** 弃用版本 */
  async deprecate(versionId, body = {}) {
    return this.#client.request({
      method: 'POST',
      path: `/api/v1/product/versions/${versionId}/deprecate`,
      authRequired: true,
      body,
    });
  }

  /** 生成 manifest */
  async generateManifest(versionId, body = {}) {
    return this.#client.request({
      method: 'POST',
      path: `/api/v1/product/versions/${versionId}/generate-manifest`,
      authRequired: true,
      body,
    });
  }

  /** Manifest 预览 */
  async previewManifest(versionId) {
    return this.#client.request({
      method: 'GET',
      path: `/api/v1/product/versions/${versionId}/manifest/preview`,
    });
  }

  /** 发布版本（manual releaseMode） */
  async publish(versionId, body = {}) {
    return this.#client.request({
      method: 'POST',
      path: `/api/v1/product/versions/${versionId}/publish`,
      authRequired: true,
      body,
    });
  }

  /** 获取发布摘要（按 productKey） */
  async downloadSummary(productKey) {
    return this.#client.request({
      method: 'GET',
      path: '/api/v1/product/versions/download-summary',
      query: { productKey },
    });
  }

  /**
   * 同步 S3 上的软件包到产品版本（核心"同步s3"按钮）
   * @param {object} params
   *   productId  {string}  catalog UUID（必填，不是 slug！）
   *   versionId  {string}  版本 UUID（必填）
   *   s3Prefix   {string}  S3 前缀（默认 clawdao/<version>）
   *   productKey {string}  可选：用于兼容旧调用，传 slug 会报错（调用方应传 productId）
   *   version    {string}  可选：传 version 时会自动查找 versionId（会发一次查询请求）
   *   dryRun     {boolean} 仅预览
   */
  async syncFromS3({ productId, versionId, s3Prefix, productKey, version, dryRun = false } = {}) {
    // 兼容性：如果只传 productKey + version，先查 versionId
    if (!productId || !versionId) {
      if (productKey && version) {
        const resolvedProductId = productId || KNOWN_PRODUCT_IDS[productKey];
        const listResult = await this.list({ productId: resolvedProductId, productKey });
        if (!listResult.ok) return listResult;
        const found = (listResult.items || []).find((v) => v.version === version);
        if (!found) {
          return { ok: false, error: { kind: 'not_found', message: `未找到版本 ${version}（productKey=${productKey}）` } };
        }
        productId = resolvedProductId;
        versionId = found.id;
      } else {
        return { ok: false, error: { kind: 'validation', message: 'productId + versionId 必填（或传 productKey + version 自动查找）' } };
      }
    }
    return this.#client.request({
      method: 'POST',
      path: '/api/v1/product/download-assets/sync-from-s3',
      authRequired: true,
      platformToken: true,  // ★ 使用 platform token（不是 DAO token）
      body: {
        productId,
        versionId,
        s3Prefix: s3Prefix || `${productKey || 'clawdao'}/${version || ''}`,
        dryRun,
      },
    });
  }

  /** 列出软件包（packages） */
  async listPackages(params = {}) {
    return this.#client.request({
      method: 'GET',
      path: '/api/v1/product/packages',
      query: params,
    });
  }

  /** 健康检查（download-assets） */
  async healthCheck() {
    return this.#client.request({
      method: 'GET',
      path: '/api/v1/product/download-assets/health',
    });
  }

  /**
   * 一键发布完整流程：整理字段 + POST 创建 + 同步 S3
   * 适用场景：版本字段已确定 + S3 已有同名版本文件夹
   *
   * @param {object} spec
   *   productKey   {string}  产品 slug
   *   version      {string}  semver
   *   releaseNotes {object|string}  HTML 字符串或 {zh:[],en:[]}
   *   title        {string}  可选
   *   isPrerelease {boolean} 可选
   *   syncS3       {boolean} 默认 true：创建后立即 sync-from-s3
   */
  async release(spec) {
    const productId = spec.productId || (spec.productKey && KNOWN_PRODUCT_IDS[spec.productKey]);
    if (!productId) {
      return { ok: false, error: { kind: 'validation', message: `未知 productKey "${spec.productKey}"，请用 --product-id 传 UUID 或扩展 KNOWN_PRODUCT_IDS` } };
    }
    const releaseNotes = typeof spec.releaseNotes === 'string' || Array.isArray(spec.releaseNotes)
      ? { ...emptyReleaseNotes(), zh: buildZhNotes(spec.releaseNotes) }
      : (spec.releaseNotes || emptyReleaseNotes());

    const steps = [];
    // Step 1: POST 创建版本
    const createResult = await this.create({ ...spec, productId, releaseNotes });
    steps.push({ step: 'create', ok: createResult.ok, message: createResult.message, data: createResult.data });
    if (!createResult.ok) return { ok: false, error: createResult.error, steps };

    const versionId = createResult.data?.id || createResult.data?.data?.id;
    const productKey = spec.productKey || spec.productKeyForSync;

    // Step 2: 同步 S3（默认开启）
    if (spec.syncS3 !== false && productKey) {
      const syncResult = await this.syncFromS3({
        productKey,
        version: spec.version,
        prefix: spec.s3Prefix,
        dryRun: spec.dryRun === true,
      });
      steps.push({ step: 'sync-s3', ok: syncResult.ok, message: syncResult.message, data: syncResult.data });
      if (!syncResult.ok) return { ok: false, error: syncResult.error, versionId, steps };
    }

    return { ok: true, versionId, steps, message: '发布流程完成' };
  }
}