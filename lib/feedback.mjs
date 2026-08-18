/**
 * 反馈提交模块 - 觉知岛用户反馈
 * 提供提交反馈、查看反馈列表等功能
 */

import { JzdClient } from './client.mjs';

export class FeedbackManager {
  #client;

  constructor(clientOrConfig) {
    this.#client = clientOrConfig instanceof JzdClient
      ? clientOrConfig
      : new JzdClient(clientOrConfig);
  }

  /**
   * 提交反馈
   * 支持多种反馈类型：建议、问题报告、功能请求、内容纠错等
   */
  async submit({
    title,
    content,
    type = 'suggestion',
    contact,
    images,
    postId,
    courseId,
  }) {
    // 根据觉知岛 API，反馈通过创建特定类型的文章或使用系统反馈接口
    // 这里使用 CMS posts 的通用提交能力
    const payload = {
      title,
      content,
      postType: 'feedback',
      feedbackType: type,
      ...(contact && { contact }),
      ...(images && { images }),
      ...(postId && { postId }),
      ...(courseId && { courseId }),
    };

    return this.#client.createPost(payload);
  }

  /**
   * 获取反馈列表
   */
  async list({ page = 1, limit = 20, status, type } = {}) {
    const result = await this.#client.listPosts({
      page,
      limit,
      postType: 'feedback',
      status: status || undefined,
      ...(type && { feedbackType: type }),
    });

    if (!result.ok) return result;

    const items = result.data?.items || result.data?.list || [];
    return {
      ok: true,
      message: result.message,
      items,
      total: result.data?.pagination?.total || items.length,
    };
  }
}
