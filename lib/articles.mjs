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

  /** 创建文章（草稿） */
  async create({
    title,
    content,
    description,
    postType = 'article',
    summary,
    coverImage,
    categoryId,
    tags,
    images,
    body,
  }) {
    const payload = {
      title,
      postType,
      ...(content && { content }),
      ...(description && { description }),
      ...(summary && { summary }),
      ...(coverImage && { coverImage }),
      ...(categoryId && { categoryId }),
      ...(tags && { tags }),
      ...(images && { images }),
      ...(body && { body }),
      status: 'draft',
    };

    return this.#client.createPost(payload);
  }

  /** 更新文章 */
  async update(postId, updates) {
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
