/**
 * 课程操作模块 - 觉知岛课程管理
 * 提供上传、列表、更新、管理等课程操作功能
 */

import { JzdClient } from './client.mjs';

export class CourseManager {
  #client;

  constructor(clientOrConfig) {
    this.#client = clientOrConfig instanceof JzdClient
      ? clientOrConfig
      : new JzdClient(clientOrConfig);
  }

  /** 列出所有课程（管理端） */
  async list({ page = 1, pageSize = 10, keyword, status, categoryUuid, sortBy, sortOrder } = {}) {
    const result = await this.#client.listCourses({
      page,
      pageSize,
      keyword: keyword || undefined,
      status: status || undefined,
      categoryUuid: categoryUuid || undefined,
      sortBy: sortBy || undefined,
      sortOrder: sortOrder || undefined,
    });

    if (!result.ok) return result;

    const data = result.data || {};
    const items = data.items || data.list || [];
    const pagination = data.pagination || { current: page, pageSize };

    return {
      ok: true,
      message: result.message,
      items,
      pagination,
      total: pagination.total || items.length,
    };
  }

  /** 列出已发布课程（公开） */
  async listPublished({ page = 1, pageSize = 10, keyword, categoryUuid } = {}) {
    const result = await this.#client.listPublishedCourses({
      page,
      pageSize,
      keyword: keyword || undefined,
      categoryUuid: categoryUuid || undefined,
    });

    if (!result.ok) return result;

    const data = result.data || {};
    const items = data.items || data.list || [];
    const pagination = data.pagination || { current: page, pageSize };

    return {
      ok: true,
      message: result.message,
      items,
      pagination,
      total: pagination.total || items.length,
    };
  }

  /** 获取课程详情 */
  async get(courseId) {
    return this.#client.getCourse(courseId);
  }

  /** 创建课程 */
  async create({
    title,
    description,
    coverImage,
    categoryUuid,
    teacherUuid,
    price = 0,
    difficulty,
    status = 'draft',
    body,
  }) {
    const payload = {
      title,
      ...(description && { description }),
      ...(coverImage && { coverImage }),
      ...(categoryUuid && { categoryUuid }),
      ...(teacherUuid && { teacherUuid }),
      price,
      ...(difficulty && { difficulty }),
      status,
      ...(body && { body }),
    };

    return this.#client.createCourse(payload);
  }

  /** 更新课程 */
  async update(courseId, updates) {
    return this.#client.updateCourse(courseId, updates);
  }

  /** 删除课程 */
  async delete(courseId) {
    return this.#client.deleteCourse(courseId);
  }

  /** 发布课程（更新状态为 published） */
  async publish(courseId) {
    return this.#client.updateCourseStatus(courseId, 'published');
  }

  /** 下架课程 */
  async unpublish(courseId) {
    return this.#client.updateCourseStatus(courseId, 'draft');
  }

  /** 上传课程（一步创建） */
  async upload({
    title,
    description,
    coverImage,
    categoryUuid,
    teacherUuid,
    price = 0,
    difficulty,
    body,
    publish: shouldPublish = false,
  }) {
    const result = await this.create({
      title,
      description,
      coverImage,
      categoryUuid,
      teacherUuid,
      price,
      difficulty,
      body,
      status: shouldPublish ? 'published' : 'draft',
    });

    if (!result.ok) return result;

    const courseId = result.data?.id || result.data?.uuid;
    return {
      ok: true,
      message: shouldPublish ? '课程已创建并发布' : '课程草稿已创建',
      data: { courseId, ...result.data },
    };
  }

  /** 列出课程分类 */
  async listCategories(params = {}) {
    return this.#client.listCourseCategories(params);
  }

  /** 创建课程分类 */
  async createCategory({ name, description, parentUuid, sort } = {}) {
    const payload = {
      name,
      ...(description && { description }),
      ...(parentUuid && { parentUuid }),
      ...(sort !== undefined && { sort }),
    };
    return this.#client.createCourseCategory(payload);
  }
}
