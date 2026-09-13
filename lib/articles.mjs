/**
 * 文章操作模块 - 觉知岛内容管理
 * 提供上传、列表、发布、删除等文章管理功能
 */

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
    postType = 'article',
    summary,
    coverImage,
    categoryId,
    tags,
    images,
    body,
    keepHead = false, // 默认剥掉 markdown 头部的 H1 + 首段引用（避免与 title/description 重复）
  }) {
    const md = contentMarkdown
      ? (keepHead ? contentMarkdown : ArticleManager.stripMarkdownHead(contentMarkdown))
      : contentMarkdown;
    // content 字段必填且 ≥20 字符（server 端 egg-validate 'min:20'）；
    // 我们把 content 也设成剥离头部后的 markdown，既满足验证又不会重复显示
    const bodyContent = content || md || 'placeholder content for contentMarkdown path';

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
    description,
    postType = 'article',
    summary,
    coverImage,
    categoryId,
    tags,
    images,
    publish: shouldPublish = false,
  }) {
    // 1. 创建草稿
    const createResult = await this.create({
      title,
      content,
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

    // 2. 如果要求发布，则执行发布
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
