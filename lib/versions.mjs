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

/**
 * ★★★ 把各种入参 releaseNotes 统一转成单一 HTML 字符串 ★★★
 *
 * 输入类型：
 *   - string 以 '<' 开头 → HTML 原文
 *   - string 其他情况 → markdown，转 HTML
 *   - array → join 为单个 string (如果是 md 转为 html)
 *   - object {zh: [], en: []} → zh[0] （或 join 所有 zh 元素）
 *   - null/undefined → ''
 *
 * 为什么这样设计：
 *   server 接收 releaseNotesZh: ["<完整 HTML>"]（1 元素数组）。
 *   前端 isHtmlContent(notes) = notes.length === 1 && /^<[a-z]/i.test(notes[0])
 *   如果 notes.length > 1 → 被当 ul/li 列表渲染 → 显示 HTML 原文。
 *   如果 notes[0] 不是 HTML → 被当 ul/li 列表渲染。
 *
 * 所以必须：合并为单个完整 HTML 字符串。
 */
export function normalizeReleaseNotes(input) {
  if (!input) return '';
  // {zh: [...], en: [...]} 对象
  if (typeof input === 'object' && !Array.isArray(input)) {
    if (Array.isArray(input.zh) && input.zh.length) {
      return normalizeReleaseNotes(input.zh.join('\n'));
    }
    return '';
  }
  // array of strings
  if (Array.isArray(input)) {
    const joined = input.filter(Boolean).join('\n');
    return normalizeReleaseNotes(joined);
  }
  // string
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<')) return trimmed;  // HTML
    // markdown → HTML
    return mdToHtml(trimmed);
  }
  return '';
}

/** HTML 转义：避免用户写的 HTML 被入入后破坏结构 */
export function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Markdown → HTML 轻量转换器（专门覆盖 release notes 常见场景）
 * 支持：
 *   - # / ## / ### 标题 → <h2> / <h3> / <h4>
 *   - > blockquote → <blockquote><p>...</p></blockquote>
 *   - **bold** → <strong>bold</strong>
 *   - *italic* → <em>italic</em>
 *   - `code` → <code>code</code>
 *   - [text](url) → <a href="url">text</a>
 *   - - item / * item → <ul><li>...</li></ul>
 *   - 1. item → <ol><li>...</li></ol>
 *   - | col | col | 表格 → <table><tr><th>...</th><tr><td>...</td></tr></table>
 *   - 分隔线 --- → <hr />
 *   - 空行分割段落 → <p>...</p>
 *
 * 不支持（不常见）：代码块、嵌套列表、脚注等。需要复杂语法请直接传 HTML 字符串。
 */
export function mdToHtml(md = '') {
  if (typeof md !== 'string') return '';
  const text = md.replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  const out = [];
  let i = 0;
  let inList = null; // 'ul' | 'ol' | null
  let inTable = false;
  let tableBuffer = []; // [[th], [td], [td], ...]
  let paraBuffer = [];

  const flushPara = () => {
    if (paraBuffer.length) {
      out.push(`<p>${inlineMd(paraBuffer.join(' '))}</p>`);
      paraBuffer = [];
    }
  };
  const closeList = () => {
    if (inList) {
      out.push(`</${inList}>`);
      inList = null;
    }
  };
  const closeTable = () => {
    if (inTable) {
      const [header, ...rows] = tableBuffer;
      const thead = `<thead><tr>${header.map((c) => `<th>${inlineMd(c.trim())}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${inlineMd(c.trim())}</td>`).join('')}</tr>`).join('')}</tbody>`;
      out.push(`<table>${thead}${tbody}</table>`);
      tableBuffer = [];
      inTable = false;
    }
  };

  const splitRow = (line) => line.split('|').slice(1, -1).map((c) => c.trim()); // 去掉首尾空

  const inlineMd = (s) => {
    // 转义 HTML 特殊字符后再加 inline markdown
    let r = escapeHtml(s);
    // inline code（必须先处理，避免被 * 等干扰）
    r = r.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    // bold（**）
    r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // italic（*）
    r = r.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    // links
    r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return r;
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, '');

    // 空行：刷新所有状态
    if (!line.trim()) {
      flushPara();
      closeList();
      closeTable();
      i += 1;
      continue;
    }

    // 表格分隔行 |---|---|
    if (/^\s*\|?\s*[-:|\s]+\s*\|?\s*$/.test(line) && inTable) {
      i += 1;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      closeTable();
      const level = h[1].length + 1; // 文档里 H1 已被产品名占，MD # → H2
      const tag = `h${Math.min(level, 6)}`;
      out.push(`<${tag}>${inlineMd(h[2])}</${tag}>`);
      i += 1;
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      flushPara();
      closeList();
      closeTable();
      const bq = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        bq.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote><p>${inlineMd(bq.join(' '))}</p></blockquote>`);
      continue;
    }

    // 表格行
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      flushPara();
      closeList();
      const row = splitRow(line);
      if (!inTable) {
        // 下一行应是分隔行
        if (i + 1 < lines.length && /^\s*\|?\s*[-:|\s]+\s*\|?\s*$/.test(lines[i + 1])) {
          inTable = true;
          tableBuffer = [row];
          i += 2;
          continue;
        } else {
          // 不是真表格 → 当段落
          paraBuffer.push(line);
          i += 1;
          continue;
        }
      } else {
        tableBuffer.push(row);
        i += 1;
        continue;
      }
    } else if (inTable) {
      closeTable();
    }

    // 分隔线
    if (/^[-*_]{3,}\s*$/.test(line)) {
      flushPara();
      closeList();
      out.push('<hr />');
      i += 1;
      continue;
    }

    // 无序列表
    if (/^[-*+]\s+/.test(line)) {
      flushPara();
      if (inList !== 'ul') {
        closeList();
        inList = 'ul';
        out.push('<ul>');
      }
      out.push(`<li>${inlineMd(line.replace(/^[-*+]\s+/, ''))}</li>`);
      i += 1;
      continue;
    }

    // 有序列表
    if (/^\d+\.\s+/.test(line)) {
      flushPara();
      if (inList !== 'ol') {
        closeList();
        inList = 'ol';
        out.push('<ol>');
      }
      out.push(`<li>${inlineMd(line.replace(/^\d+\.\s+/, ''))}</li>`);
      i += 1;
      continue;
    }

    // 普通段落
    closeList();
    paraBuffer.push(line);
    i += 1;
  }

  flushPara();
  closeList();
  closeTable();

  return out.join('\n');
}

/** 把一段 HTML 段落塞进 releaseNotes.zh */
export const buildZhNotes = (htmlOrArray) => {
  if (Array.isArray(htmlOrArray)) return htmlOrArray.filter(Boolean);
  if (typeof htmlOrArray === 'string' && htmlOrArray.trim()) return [htmlOrArray];
  return [];
};

/** 便捷：如果传入的 releaseNotes 是 markdown，自动转为 HTML */
export const buildZhNotesFromMd = (mdOrHtml) => {
  if (Array.isArray(mdOrHtml)) return mdOrHtml.filter(Boolean);
  if (typeof mdOrHtml !== 'string' || !mdOrHtml.trim()) return [];
  // 简单判断：含有 <h2>/<p>/<ol>/<blockquote> 则不转换；否则视为 markdown
  if (/<(h[1-6]|p|ul|ol|blockquote|table|hr)(\s|>|\/)/i.test(mdOrHtml)) return [mdOrHtml];
  return [mdToHtml(mdOrHtml)];
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
    // ★ releaseNotes 字段转换：markdown → HTML 字符串
    // ★★★ server 的 schema：releaseNotesZh: ["<完整 HTML 字符串>"]（1 元素数组）
    //   因为前端 isHtmlContent(notes) = notes.length === 1 && /^<[a-z]/i.test(notes[0])
    //   如果 notes.length > 1，会被当 ul/li 列表渲染 -> 看到的是 HTML 原文
    const releaseNotesStr = normalizeReleaseNotes(body.releaseNotes);

    const payload = {
      productId: body.productId,
      version: body.version,
      // ★ 重点：传 releaseNotesZh（不是 releaseNotes）！！！
      ...(releaseNotesStr ? { releaseNotesZh: [releaseNotesStr] } : {}),
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
      platformToken: true,
      body: payload,
    });
  }

  /** 更新版本 */
  async update(versionId, body) {
    // ★ releaseNotes 输入可能是 string (md/html) 或 object {zh:[]}
    // ★ 转成 releaseNotesZh: [single HTML] 才能与前端 isHtmlContent() 兼容
    if (body.releaseNotes !== undefined) {
      const str = normalizeReleaseNotes(body.releaseNotes);
      const next = { ...body };
      delete next.releaseNotes;
      if (str) {
        next.releaseNotesZh = [str];
      }
      body = next;
    }
    return this.#client.request({
      method: 'PUT',
      path: `/api/v1/product/versions/${versionId}`,
      authRequired: true,
      platformToken: true,
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
        // ★ 修复：显式传 status: undefined，否则 server 默认按 published 过滤，找不到 draft
        const listResult = await this.list({ productId: resolvedProductId, productKey, status: undefined });
        if (!listResult.ok) return listResult;
        const found = (listResult.items || []).find((v) => v.version === version);
        if (!found) {
          return { ok: false, error: { kind: 'not_found', message: `未找到版本 ${version}（productKey=${productKey}，已查全部状态）` } };
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
        // ★ 修复：默认 prefix 加尾部斜杠，避免把 clawdao/1.0.29-rc1/... 误同步进 1.0.29
        s3Prefix: s3Prefix || `${productKey || 'clawdao'}/${version || ''}/`,
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