/**
 * 觉知岛素材库（materials）模块
 *
 * 封装觉知岛 DDN Hub 的素材上传接口（`POST /api/v1/material/files/upload`），
 * 供 CLI `jzd upload` 子命令、`scripts/publisher.mjs` 通用发布器以及未来
 * 课程 / 应用市场 / 反馈 等模块复用。
 *
 * 接口契约（probe_upload9.mjs / scripts/publisher.mjs:134 已验证）：
 *   - 请求：multipart/form-data
 *       daoId: <uuid>            （当前 DAO，必填）
 *       type:  image|video|file  （默认 image）
 *       file:  <binary>          （必填，字段名固定为 file）
 *   - 响应：{ status, msg, data: { url, filename, size, ... } }
 *       status === 0 表示成功；data.url 是可公开访问的 CDN URL
 *
 * 设计原则：
 *   - 与其他 Manager 保持一致（构造接收 JzdClient，方法返回 {ok,...}）
 *   - 上传是 I/O 密集操作，构造函数不读取文件
 *   - 不重复 fetch 同一文件：uploadBatch() 用绝对路径做去重
 *   - 失败时返回标准错误结构（不抛异常），便于 CLI 统一展示
 */

import { existsSync, statSync, readFileSync } from 'fs';
import { resolve, basename, extname, isAbsolute } from 'path';
import { JzdClient } from './client.mjs';

export const MATERIAL_TYPES = ['image', 'video', 'file'];
export const MATERIAL_TYPE_LABELS = {
  image: '图片',
  video: '视频',
  file: '文件',
};

/** 兜底 MIME 推断（Node 18+ 内置 MIME 映射不完整时使用） */
const inferMime = (filePath) => {
  const ext = extname(filePath).slice(1).toLowerCase();
  if (!ext) return 'application/octet-stream';
  const map = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    avif: 'image/avif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
  };
  return map[ext] || `application/${ext}`;
};

export class MaterialManager {
  #client;

  constructor(clientOrConfig) {
    this.#client = clientOrConfig instanceof JzdClient
      ? clientOrConfig
      : new JzdClient(clientOrConfig);
  }

  /** 健康检查：当前 DAO 是否可调用上传接口（只验证配置） */
  health() {
    const cfg = this.#client.getRuntimeSnapshot();
    const missing = [];
    if (!cfg.baseUrlValid) missing.push('baseUrl 无效');
    if (!cfg.hasAuthToken) missing.push('缺少 DDN_HUB_AUTH_TOKEN');
    if (!cfg.hasDaoId) missing.push('缺少 DDN_HUB_DAO_ID');
    return {
      ok: missing.length === 0,
      message: missing.length === 0 ? 'ready' : missing.join('；'),
      config: cfg,
    };
  }

  /**
   * 上传单个本地文件到觉知岛素材库
   *
   * @param {string} filePath  本地文件绝对路径或相对 cwd 路径
   * @param {object} [opts]
   * @param {string} [opts.type='image']     image / video / file
   * @param {string} [opts.daoId]            覆盖默认 DAO（高级用法）
   * @param {string} [opts.filename]         重命名上传后的文件名（默认 basename(filePath)）
   * @returns {Promise<{ok:boolean, url?:string, data?:object, message?:string, statusCode?:number}>}
   */
  async upload(filePath, opts = {}) {
    const absPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);

    if (!existsSync(absPath)) {
      return {
        ok: false,
        message: `文件不存在: ${absPath}`,
        error: { kind: 'not_found', message: `文件不存在: ${absPath}` },
      };
    }
    const size = statSync(absPath).size;
    if (size === 0) {
      return {
        ok: false,
        message: `文件为空: ${absPath}`,
        error: { kind: 'invalid_input', message: `文件为空: ${absPath}` },
      };
    }

    const type = opts.type || 'image';
    if (!MATERIAL_TYPES.includes(type)) {
      return {
        ok: false,
        message: `不支持的素材类型: ${type}（允许：${MATERIAL_TYPES.join(', ')}）`,
        error: { kind: 'invalid_input', message: 'type 取值非法' },
      };
    }

    const daoId = opts.daoId || process.env.DDN_HUB_DAO_ID;
    if (!daoId) {
      return {
        ok: false,
        message: '缺少 DAO ID（设置 DDN_HUB_DAO_ID 或传 --dao-id）',
        error: { kind: 'config_error', message: '缺少 DAO ID' },
      };
    }

    const cfg = this.#client.getConfig();
    if (!cfg.authToken) {
      return {
        ok: false,
        message: '缺少 DDN_HUB_AUTH_TOKEN',
        error: { kind: 'config_error', message: '缺少 auth token' },
      };
    }

    const filename = opts.filename || basename(absPath);

    // 用 Blob 包装（与 probe_upload9.mjs / publisher.mjs 已验证的实现一致）
    const fileBuf = readFileSync(absPath);
    const blob = new Blob([fileBuf], { type: inferMime(absPath) });
    const fd = new FormData();
    fd.append('daoId', daoId);
    fd.append('type', type);
    fd.append('file', blob, filename);

    const url = new URL('/api/v1/material/files/upload', cfg.baseUrl).toString();
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.authToken}`,
          'X-Dao-Id': daoId,
          'x-dao-id': daoId,
          'User-Agent': '@juezhidao/jzd-ops/0.1.0',
        },
        body: fd,
      });
    } catch (err) {
      return {
        ok: false,
        message: `网络错误: ${err instanceof Error ? err.message : String(err)}`,
        error: { kind: 'network_error', message: '网络请求失败' },
      };
    }

    // 解析响应（可能 JSON 也可能 text）
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }

    if (!res.ok) {
      return {
        ok: false,
        statusCode: res.status,
        message: body?.msg || body?.message || `上传失败，HTTP ${res.status}`,
        data: body?.data || null,
        error: { kind: 'http_error', message: body?.msg || `HTTP ${res.status}`, statusCode: res.status },
      };
    }

    // 业务错误：status === 1 表示后端业务错误（与 JzdClient 约定一致）
    if (body && typeof body === 'object' && body.status === 1) {
      return {
        ok: false,
        statusCode: res.status,
        message: body.msg || body.message || '上传失败',
        data: body.data || null,
        error: { kind: 'business_error', message: body.msg || '业务错误', statusCode: res.status },
      };
    }

    const dataUrl = body?.data?.url || body?.data?.fileUrl || body?.data?.path;
    if (!dataUrl) {
      return {
        ok: false,
        statusCode: res.status,
        message: '上传成功但响应中未返回 URL',
        data: body?.data,
        error: { kind: 'parse_error', message: '响应缺少 url 字段' },
      };
    }

    return {
      ok: true,
      url: dataUrl,
      filename,
      size,
      type,
      data: body.data,
      message: '上传成功',
    };
  }

  /**
   * 批量上传本地文件列表，自动去重（同一绝对路径只上传一次）
   *
   * @param {string[]} filePaths  本地路径数组（绝对路径或相对 cwd）
   * @param {object}   [opts]     同 upload() 的 opts
   * @returns {Promise<{
   *   ok: boolean,
   *   map: Map<string, string>,    // 绝对路径 → CDN URL（成功）
   *   failures: Array<{path:string, message:string}>,
   *   message: string,
   * }>}
   */
  async uploadBatch(filePaths, opts = {}) {
    const map = new Map();
    const failures = [];

    // 去重但保留顺序
    const seen = new Set();
    const unique = [];
    for (const p of filePaths) {
      const abs = isAbsolute(p) ? p : resolve(process.cwd(), p);
      if (seen.has(abs)) continue;
      seen.add(abs);
      unique.push(abs);
    }

    for (const abs of unique) {
      const r = await this.upload(abs, opts);
      if (r.ok && r.url) {
        map.set(abs, r.url);
      } else {
        failures.push({ path: abs, message: r.message || '未知错误' });
      }
    }

    return {
      ok: failures.length === 0,
      map,
      failures,
      message: failures.length === 0
        ? `全部 ${map.size} 个文件上传成功`
        : `${map.size} 成功 / ${failures.length} 失败`,
    };
  }
}
