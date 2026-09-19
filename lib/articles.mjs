/**
 * 文章操作模块 - 觉知岛内容管理
 * 提供上传、列表、发布、删除等文章管理功能
 *
 * ★ postType 枚举（ddn-hub 升级后）
 * 历史版本只有 `article`；升级后服务端扩展为多类型（news / help / article），
 * 旧文章保留为 null（历史遗留，未分类）。
 * 这里集中维护合法值与默认值，CLI 层在调用前先做白名单校验，
 * 避免把未知值（announcement/tutorial/blog 等）直接打到服务端被静默忽略。
 */

/** 已知合法的 postType 值（ddn-hub 升级后实测枚举） */
export const POST_TYPES = Object.freeze(['news', 'help', 'article']);

/** postType → 中文标签，用于 CLI 帮助与列表展示 */
export const POST_TYPE_LABELS = Object.freeze({
  news: '资讯',
  help: '教程/帮助',
  article: '通用文章',
});

/** 新建内容时的默认 postType（升级后运营主流） */
export const DEFAULT_POST_TYPE = 'news';

/** 判断一个值是否为合法 postType */
export const isValidPostType = (value) =>
  typeof value === 'string' && POST_TYPES.includes(value);

import { JzdClient } from './client.mjs';

export class ArticleManager {
  #client;

  constructor(clientOrConfig) {
    this.#client = clientOrConfig instanceof JzdClient
      ? clientOrConfig
      : new JzdClient(clientOrConfig);
  }

  /** 列出文章 */
  async list({ page = 1, limit = 10, postType, status, search, categoryId } = {}) {
    // ★ 防御：未知 postType 直接抛错，避免被服务端静默忽略后让人误以为“查不到”
    if (postType !== undefined && postType !== null && postType !== '' && !isValidPostType(postType)) {
      throw new Error(
        `未知的 postType "${postType}"。当前 ddn-hub 合法值为: ${POST_TYPES.join(' / ')}`
      );
    }
    const result = await this.#client.listPosts({
      page,
      limit,
      postType: postType || undefined,
      status: status || undefined,
      search: search || undefined,
      categoryId: categoryId || undefined,
      includeAttributes: false,
    });

    if (!result.ok) return result;

    // 统一分页格式
    const items = result.data?.items || result.data?.list || [];
    const pagination = result.data?.pagination || { current: page, pageSize: limit };

    return {
      ok: true,
      message: result.message,
      items,
      pagination,
      total: pagination.total || items.length,
    };
  }

  /** 获取文章详情 */
  async get(postId) {
    return this.#client.getPost(postId);
  }

  /**
   * 从 markdown 顶部剥掉 H1 标题和首段 blockquote（避免与 title/description 字段重复显示）
   * @param {string} md - markdown 原文
   * @returns {string} 去掉头部后的 markdown
   */
  static stripMarkdownHead(md) {
    if (!md) return md;
    let out = md;
    // 去掉首个 H1 行
    out = out.replace(/^# .+\n+/m, '');
    // 去掉紧随的连续 blockquote（> xxx / > xxx \n\n）
    out = out.replace(/^(?:> .+\n)+\n*/m, '');
    return out;
  }

  /** 创建文章（草稿） */
  async create({
    title,
    content,
    contentMarkdown,
    description,
    postType = DEFAULT_POST_TYPE,
    summary,
    coverImage,
    categoryId,
    tags,
    images,
    body,
    keepHead = false, // 默认剥掉 markdown 头部的 H1 + 首段引用（避免与 title/description 重复）
  }) {
    // ★ 校验 postType 合法值
    if (!isValidPostType(postType)) {
      throw new Error(
        `未知的 postType "${postType}"。当前 ddn-hub 合法值为: ${POST_TYPES.join(' / ')}`
      );
    }
    const md = contentMarkdown
      ? (keepHead ? contentMarkdown : ArticleManager.stripMarkdownHead(contentMarkdown))
      : contentMarkdown;
    // content 字段必填且 ≥20 字符（server 端 egg-validate 'min:20'）。
    // 优先级：调用者显式传的 content > 剥离头部后的 markdown > fallback 占位。
    // ★ 修复：以前 contentMarkdown 存在但 content 缺失时会退化为 'placeholder'，
    //   导致发布的文章正文全是占位字符串。这里改为把 md 直接作为 content。
    const bodyContent = (content && content.length >= 20)
      ? content
      : (md && md.length >= 20
          ? md
          : (content || md || 'placeholder content for contentMarkdown path'));

    const payload = {
      title,
      postType,
      content: bodyContent,
      ...(md && { contentMarkdown: md }),
      ...(description && { description }),
      ...(summary && { summary }),
      ...(coverImage && { coverImage }),
      ...(categoryId != null && { categoryId }),
      ...(tags && { tags }),
      ...(images && { images }),
      ...(body && { body }),
      status: 'draft',
    };


    return this.#client.createPost(payload);
  }

  /** 更新文章 */
  async update(postId, updates) {
    // 如果 updates 里有 contentMarkdown，默认剥掉头部（除非显式 keepHead）
    if (updates?.contentMarkdown && !updates.keepHead) {
      const stripped = ArticleManager.stripMarkdownHead(updates.contentMarkdown);
      updates = {
        ...updates,
        contentMarkdown: stripped,
        // 同时把 content 也更新成剥离头部后的 markdown，避免编辑模式显示占位
        content: updates.content || stripped,
      };
    }
    return this.#client.updatePost(postId, updates);
  }

  /** 发布文章 */
  async publish(postId) {
    return this.#client.publishPost(postId);
  }

  /** 删除文章 */
  async delete(postId) {
    return this.#client.deletePost(postId);
  }

  /** 上传文章（一步完成：创建草稿并发布） */
  async upload({
    title,
    content,
    contentMarkdown,
    description,
    postType = DEFAULT_POST_TYPE,
    summary,
    coverImage,
    categoryId,
    tags,
    images,
    extraData,
    publish: shouldPublish = false,
  }) {
    // ★ 校验 postType 合法值
    if (!isValidPostType(postType)) {
      throw new Error(
        `未知的 postType "${postType}"。当前 ddn-hub 合法值为: ${POST_TYPES.join(' / ')}`
      );
    }
    // 1. 创建草稿（透传 contentMarkdown，让 create() 自动把 md 剥头部后填到 content）
    const createResult = await this.create({
      title,
      content,
      contentMarkdown,
      description,
      postType,
      summary,
      coverImage,
      categoryId,
      tags,
      images,
    });

    if (!createResult.ok) return createResult;

    const postId = createResult.data?.id;
    if (!postId) {
      return { ok: false, message: '创建文章成功但未返回ID', data: createResult.data };
    }

    // 2. 如果有 extraData，PUT 一次（POST 接口不会持久化 extraData）
    if (extraData && Object.keys(extraData).length > 0) {
      const updateResult = await this.update(postId, { extraData });
      if (!updateResult.ok) {
        return {
          ok: false,
          message: `创建成功但 extraData 设置失败: ${updateResult.message}`,
          data: { postId, create: createResult.data, updateError: updateResult.data },
        };
      }
    }

    // 3. 如果要求发布，则执行发布
    if (shouldPublish) {
      const publishResult = await this.publish(postId);
      return {
        ok: publishResult.ok,
        message: publishResult.ok ? '文章已创建并发布' : `文章已创建但发布失败: ${publishResult.message}`,
        data: { postId, draft: createResult.data, publish: publishResult.data },
        publishError: publishResult.ok ? null : publishResult,
      };
    }

    return {
      ok: true,
      message: '文章草稿已创建',
      data: { postId, ...createResult.data },
    };
  }
}
