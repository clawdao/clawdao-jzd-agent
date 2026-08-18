#!/usr/bin/env node

/**
 * 觉知岛运营助手 CLI
 * 用法: jzd-ops <command> [options]
 *
 * 命令:
 *   article    文章管理（上传、列表、发布）
 *   course     课程管理（上传、列表、发布）
 *   feedback   提交反馈
 *   health     健康检查
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

/** 零依赖 .env 加载器：项目根 .env → process.env（仅补缺失项，不覆盖已存在的环境变量） */
const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, '..', '.env');
try {
  if (existsSync(ENV_PATH)) {
    for (const line of readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eq = trimmed.indexOf('=');
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  }
} catch { /* .env 缺失或不可读时忽略，直接使用环境变量 */ }

import { JzdClient } from '../lib/client.mjs';
import { ArticleManager } from '../lib/articles.mjs';
import { CourseManager } from '../lib/courses.mjs';
import { FeedbackManager } from '../lib/feedback.mjs';
import { MarketplaceManager, ASSET_TYPES, ASSET_TYPE_LABELS, ASSET_STATUSES, PRICE_TYPE_LABELS } from '../lib/marketplace.mjs';

const COMMANDS = {
  article: '文章管理：list, create, publish, delete',
  course: '课程管理：list, create, publish, delete, categories',
  feedback: '提交反馈或查看反馈列表',
  marketplace: '应用市场：list, stats, get, create, update, publish, remove, categories',
  health: '检查 API 服务状态',
};

function printUsage() {
  console.log(`
╔══════════════════════════════════════════╗
║       觉知岛运营助手 (jzd-ops)          ║
║     DDN Hub 运营操作 CLI 工具           ║
╚══════════════════════════════════════════╝

用法: jzd-ops <command> [子命令] [选项]

命令:
  article list        列出文章
  article create      创建文章草稿
  article publish     <postId>  发布文章
  article upload      上传文章（创建并可选发布）

  course list         列出课程
  course create       创建课程
  course publish      <courseId>  发布课程
  course upload       上传课程（创建并可选发布）
  course categories   列出课程分类

  feedback submit     提交反馈
  feedback list       查看反馈列表

  marketplace list    列出应用市场资产（--admin 查看管理端含草稿）
  marketplace stats   统计资产（按类型/状态）
  marketplace get     <uuid> 查看资产详情
  marketplace create  新建资产（上架应用）
  marketplace update  <uuid> 编辑资产
  marketplace publish <uuid> 上架（active）
  marketplace unpublish <uuid> 下架（inactive）
  marketplace draft   <uuid> 转草稿（draft）
  marketplace featured <uuid> 设置精选
  marketplace remove  <uuid> 删除资产（仅 draft）
  marketplace categories 查看类目聚合

  health              检查 API 连接

环境变量:
  DDN_HUB_BASE_URL    API 地址（默认: https://ddn.net）
  DDN_HUB_AUTH_TOKEN  认证令牌
  DDN_HUB_DAO_ID      DAO ID

示例:
  jzd-ops health
  jzd-ops article list --postType article
  jzd-ops article create --title "标题" --content "内容"
  jzd-ops article publish 42
  jzd-ops article upload --title "T" --content "C" --publish
  jzd-ops course list
  jzd-ops course create --title "课程名"
  jzd-ops feedback submit --title "建议" --content "详情"
`);
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        options[key] = args[++i];
      } else {
        options[key] = true;
      }
    }
  }
  return options;
}

function getClient() {
  // 不打印 token 信息到日志
  const client = new JzdClient();
  const config = client.getConfig();
  return client;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case 'article':
      await handleArticle(args.slice(1));
      break;
    case 'course':
      await handleCourse(args.slice(1));
      break;
    case 'feedback':
      await handleFeedback(args.slice(1));
      break;
    case 'marketplace':
      await handleMarketplace(args.slice(1));
      break;
    case 'health':
      await handleHealth();
      break;
    case 'help':
    case '--help':
      printUsage();
      break;
    default:
      console.error(`未知命令: ${command}\n`);
      printUsage();
      process.exit(1);
  }
}

// ===== 文章操作 =====

async function handleArticle(args) {
  const sub = args[0];
  const opts = parseArgs(args.slice(1));
  const article = new ArticleManager(getClient());

  switch (sub) {
    case 'list': {
      const result = await article.list({
        postType: opts.postType,
        status: opts.status,
        search: opts.search,
        page: opts.page ? parseInt(opts.page) : 1,
        limit: opts.limit ? parseInt(opts.limit) : 10,
      });
      if (!result.ok) return printError(result);
      console.log(`\n📄 文章列表 (共 ${result.total} 篇):\n`);
      for (const item of (result.items || [])) {
        console.log(`  [${item.id}] ${item.title || '(无标题)'}`);
        console.log(`        类型: ${item.postType} | 状态: ${item.status} | 更新: ${item.updatedAt || '-'}`);
        console.log();
      }
      break;
    }
    case 'create': {
      if (!opts.title) return console.error('❌ 请指定 --title');
      const result = await article.create({
        title: opts.title,
        content: opts.content || opts.body,
        postType: opts.postType || 'article',
        summary: opts.summary,
        body: opts.body,
      });
      if (!result.ok) return printError(result);
      const id = result.data?.id;
      console.log(`\n✅ 草稿已创建 (ID: ${id})`);
      console.log(`   标题: ${opts.title}`);
      console.log(`   类型: ${opts.postType || 'article'}`);
      console.log(`   发布: jzd-ops article publish ${id}\n`);
      break;
    }
    case 'publish': {
      const postId = args[1];
      if (!postId || isNaN(parseInt(postId))) return console.error('❌ 请指定文章 ID: jzd-ops article publish <postId>');
      const result = await article.publish(parseInt(postId));
      if (!result.ok) return printError(result);
      console.log(`\n✅ 文章 ${postId} 已发布\n`);
      break;
    }
    case 'upload': {
      if (!opts.title) return console.error('❌ 请指定 --title');
      const shouldPublish = opts.publish === true || opts.publish === 'true';
      const result = await article.upload({
        title: opts.title,
        content: opts.content || opts.body,
        postType: opts.postType || 'article',
        summary: opts.summary,
        publish: shouldPublish,
      });
      if (!result.ok) return printError(result);
      console.log(`\n✅ ${result.message}`);
      if (result.data?.postId) {
        console.log(`   ID: ${result.data.postId}`);
      }
      console.log();
      break;
    }
    default:
      console.error(`
文章管理子命令:
  jzd-ops article list [--postType article] [--status draft] [--search keyword]
  jzd-ops article create --title "标题" [--content "内容"] [--postType article]
  jzd-ops article publish <postId>
  jzd-ops article upload --title "标题" --content "内容" [--publish]
`);
  }
}

// ===== 课程操作 =====

async function handleCourse(args) {
  const sub = args[0];
  const opts = parseArgs(args.slice(1));
  const course = new CourseManager(getClient());

  switch (sub) {
    case 'list': {
      const result = await course.list({
        keyword: opts.keyword,
        status: opts.status,
        page: opts.page ? parseInt(opts.page) : 1,
        pageSize: opts.pageSize ? parseInt(opts.pageSize) : 10,
      });
      if (!result.ok) return printError(result);
      console.log(`\n📚 课程列表 (共 ${result.total} 门):\n`);
      for (const item of (result.items || [])) {
        console.log(`  [${item.id || item.uuid}] ${item.title || '(无标题)'}`);
        console.log(`        状态: ${item.status === 1 ? '已发布' : '草稿'} | 价格: ${item.price || 0}`);
        console.log();
      }
      break;
    }
    case 'categories': {
      const result = await course.listCategories();
      if (!result.ok) return printError(result);
      const items = result.data?.items || result.data?.list || [];
      console.log(`\n📂 课程分类:\n`);
      for (const cat of items) {
        console.log(`  [${cat.uuid}] ${cat.name}`);
      }
      console.log();
      break;
    }
    case 'create': {
      if (!opts.title) return console.error('❌ 请指定 --title');
      const result = await course.create({
        title: opts.title,
        description: opts.description,
        coverImage: opts.coverImage,
        categoryUuid: opts.categoryUuid,
        teacherUuid: opts.teacherUuid,
        price: opts.price ? parseFloat(opts.price) : undefined,
        status: opts.publish ? 'published' : 'draft',
      });
      if (!result.ok) return printError(result);
      const id = result.data?.id || result.data?.uuid;
      console.log(`\n✅ 课程已创建 (ID: ${id})`);
      console.log(`   标题: ${opts.title}`);
      console.log(`   状态: ${opts.publish ? '已发布' : '草稿'}`);
      console.log(`   发布: jzd-ops course publish ${id}\n`);
      break;
    }
    case 'publish': {
      const courseId = args[1];
      if (!courseId) return console.error('❌ 请指定课程 ID: jzd-ops course publish <courseId>');
      const result = await course.publish(courseId);
      if (!result.ok) return printError(result);
      console.log(`\n✅ 课程 ${courseId} 已发布\n`);
      break;
    }
    case 'upload': {
      if (!opts.title) return console.error('❌ 请指定 --title');
      const shouldPublish = opts.publish === true || opts.publish === 'true';
      const result = await course.upload({
        title: opts.title,
        description: opts.description,
        coverImage: opts.coverImage,
        categoryUuid: opts.categoryUuid,
        teacherUuid: opts.teacherUuid,
        price: opts.price ? parseFloat(opts.price) : 0,
        publish: shouldPublish,
      });
      if (!result.ok) return printError(result);
      console.log(`\n✅ ${result.message}`);
      if (result.data?.courseId) {
        console.log(`   ID: ${result.data.courseId}`);
      }
      console.log();
      break;
    }
    default:
      console.error(`
课程管理子命令:
  jzd-ops course list [--keyword xxx] [--status published]
  jzd-ops course create --title "课程名" [--description "描述"] [--price 0] [--publish]
  jzd-ops course publish <courseId>
  jzd-ops course upload --title "课程名" --description "描述" [--publish]
  jzd-ops course categories
`);
  }
}

// ===== 反馈操作 =====

async function handleFeedback(args) {
  const sub = args[0];
  const opts = parseArgs(args.slice(1));
  const feedback = new FeedbackManager(getClient());

  switch (sub) {
    case 'submit': {
      if (!opts.title) return console.error('❌ 请指定反馈 --title');
      const result = await feedback.submit({
        title: opts.title,
        content: opts.content || '',
        type: opts.type || 'suggestion',
        contact: opts.contact,
      });
      if (!result.ok) return printError(result);
      console.log(`\n✅ 反馈已提交: "${opts.title}"\n`);
      break;
    }
    case 'list': {
      const result = await feedback.list({
        type: opts.type,
        status: opts.status,
        page: opts.page ? parseInt(opts.page) : 1,
        limit: opts.limit ? parseInt(opts.limit) : 20,
      });
      if (!result.ok) return printError(result);
      console.log(`\n💬 反馈列表 (共 ${result.total} 条):\n`);
      for (const item of (result.items || [])) {
        console.log(`  [${item.id}] ${item.title}`);
        console.log(`        类型: ${item.feedbackType || item.postType} | 状态: ${item.status}`);
        console.log();
      }
      break;
    }
    default:
      console.error(`
反馈子命令:
  jzd-ops feedback submit --title "反馈标题" [--content "详情"] [--type suggestion|bug|feature]
  jzd-ops feedback list [--type suggestion]
`);
  }
}

// ===== 应用市场操作 =====

function assetLine(item) {
  const type = ASSET_TYPE_LABELS[item.type] || item.type || 'unknown';
  const price = PRICE_TYPE_LABELS[item.priceType] || item.priceType || '-';
  const featured = item.isFeatured ? ' ⭐' : '';
  const rating = item.rating ? ` | ⭐${Number(item.rating).toFixed(1)}` : '';
  const downloads = item.downloadCount ? ` | ↓${item.downloadCount}` : '';
  return `  [${type}] ${item.name}${featured}\n        状态: ${item.status} | 定价: ${price} | 版本: ${item.version || '-'}${rating}${downloads}\n        UUID: ${item.uuid}`;
}

async function handleMarketplace(args) {
  const sub = args[0];
  const opts = parseArgs(args.slice(1));
  const mp = new MarketplaceManager(getClient());
  const isAdmin = opts.admin === true || opts.admin === 'true';

  switch (sub) {
    case 'list': {
      const result = isAdmin
        ? await mp.listAdmin({ type: opts.type, status: opts.status, keyword: opts.keyword, page: opts.page ? parseInt(opts.page) : 1, pageSize: opts.pageSize ? parseInt(opts.pageSize) : 20 })
        : await mp.list({ type: opts.type, keyword: opts.keyword, category: opts.category, tag: opts.tag, sort: opts.sort, page: opts.page ? parseInt(opts.page) : 1, pageSize: opts.pageSize ? parseInt(opts.pageSize) : 20 });
      if (!result.ok) return printError(result);
      const title = isAdmin ? '管理端资产' : '应用市场资产';
      console.log(`\n🧩 ${title} (共 ${result.total} 个):\n`);
      for (const item of (result.items || [])) {
        console.log(assetLine(item));
        console.log();
      }
      if (result.totalPages > 1) console.log(`  … 第 ${result.page}/${result.totalPages} 页（共 ${result.total} 个）`);
      break;
    }
    case 'stats': {
      const result = await mp.stats();
      if (!result.ok) return printError(result);
      console.log(`\n📊 应用市场统计 (共 ${result.total} 个资产):\n`);
      // 上架应用清单优先展示（关键信息前置）
      const active = (result.items || []).filter((i) => i.status === 'active');
      console.log('  上架应用 (active):');
      if (active.length === 0) {
        console.log('    （暂无已上架资产）');
      } else {
        for (const item of active) {
          console.log(`    [${ASSET_TYPE_LABELS[item.type] || item.type}] ${item.name}${item.isFeatured ? ' ⭐' : ''}`);
        }
      }
      console.log('\n  按类型:');
      for (const [t, n] of Object.entries(result.byType).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${ASSET_TYPE_LABELS[t] || t}: ${n}`);
      }
      console.log('\n  按状态:');
      for (const [s, n] of Object.entries(result.byStatus).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${s}: ${n}`);
      }
      console.log();
      break;
    }
    case 'get': {
      const uuid = args[1];
      if (!uuid) return console.error('❌ 请指定资产 UUID: jzd-ops marketplace get <uuid>');
      const result = await mp.get(uuid);
      if (!result.ok) return printError(result);
      const a = result.data || {};
      console.log(`\n📦 资产详情: ${a.name}\n`);
      console.log(`  UUID:        ${a.uuid}`);
      console.log(`  类型:        ${ASSET_TYPE_LABELS[a.type] || a.type}`);
      console.log(`  Slug:        ${a.slug}`);
      console.log(`  状态:        ${a.status}`);
      console.log(`  定价:        ${PRICE_TYPE_LABELS[a.priceType] || a.priceType}${a.price ? ` (¥${a.price})` : ''}${a.pointsCost ? ` (${a.pointsCost}积分)` : ''}`);
      console.log(`  版本:        ${a.version || '-'}${a.minVersion ? ` (最低 ${a.minVersion})` : ''}`);
      console.log(`  作者:        ${a.author || '-'}`);
      console.log(`  类目:        ${a.category || '-'}`);
      console.log(`  标签:        ${(a.tags || []).join(', ') || '-'}`);
      console.log(`  评分:        ${a.rating ? `⭐${Number(a.rating).toFixed(1)} (${a.ratingCount || 0}人)` : '-'}`);
      console.log(`  下载:        ${a.downloadCount || 0}`);
      console.log(`  精选:        ${a.isFeatured ? '✅ 是' : '否'}`);
      if (a.sourceUrl) console.log(`  源码:        ${a.sourceUrl}`);
      if (a.configUrl) console.log(`  配置:        ${a.configUrl}`);
      if (a.description) console.log(`  描述:        ${a.description}`);
      console.log();
      break;
    }
    case 'create': {
      if (!opts.name) return console.error('❌ 请指定 --name（资产名称）');
      if (!opts.type) return console.error(`❌ 请指定 --type（${ASSET_TYPES.join(' / ')}）`);
      const result = await mp.create({
        type: opts.type,
        slug: opts.slug || opts.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
        name: opts.name,
        description: opts.description,
        icon: opts.icon,
        category: opts.category,
        author: opts.author,
        version: opts.version,
        sourceUrl: opts.sourceUrl,
        configUrl: opts.configUrl,
        priceType: opts.priceType,
        price: opts.price !== undefined ? parseFloat(opts.price) : undefined,
        pointsCost: opts.pointsCost !== undefined ? parseInt(opts.pointsCost) : undefined,
        isFeatured: opts.featured === 'true' || opts.featured === true ? true : undefined,
        tags: opts.tags ? opts.tags.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      });
      if (!result.ok) return printError(result);
      const a = result.data || {};
      console.log(`\n✅ 资产已创建`);
      console.log(`   UUID: ${a.uuid || result.data?.uuid}`);
      console.log(`   名称: ${opts.name}`);
      console.log(`   类型: ${opts.type} | Slug: ${opts.slug || ''}`);
      console.log(`   上架: jzd-ops marketplace publish ${a.uuid || ''}\n`);
      break;
    }
    case 'update': {
      const uuid = args[1];
      if (!uuid) return console.error('❌ 请指定资产 UUID: jzd-ops marketplace update <uuid> --name "新名称"');
      const updates = {};
      for (const f of ['type', 'slug', 'name', 'description', 'icon', 'category', 'author', 'version', 'sourceUrl', 'configUrl', 'priceType']) {
        if (opts[f] !== undefined) updates[f] = opts[f];
      }
      if (opts.price !== undefined) updates.price = parseFloat(opts.price);
      if (opts.pointsCost !== undefined) updates.pointsCost = parseInt(opts.pointsCost);
      if (opts.tags !== undefined) updates.tags = opts.tags.split(',').map((s) => s.trim()).filter(Boolean);
      if (opts.featured === 'true' || opts.featured === true) updates.isFeatured = true;
      if (opts.featured === 'false') updates.isFeatured = false;
      if (Object.keys(updates).length === 0) {
        return console.error('❌ 没有需要更新的字段，例如: --name / --description / --price / --category');
      }
      const result = await mp.update(uuid, updates);
      if (!result.ok) return printError(result);
      console.log(`\n✅ 资产 ${uuid} 已更新: ${Object.keys(updates).join(', ')}\n`);
      break;
    }
    case 'publish':
    case 'unpublish':
    case 'draft':
    case 'archive': {
      const uuid = args[1];
      if (!uuid) return console.error(`❌ 请指定资产 UUID: jzd-ops marketplace ${sub} <uuid>`);
      const statusMap = { publish: 'active', unpublish: 'inactive', draft: 'draft', archive: 'archived' };
      const target = statusMap[sub];
      const result = await mp.updateStatus(uuid, target);
      if (!result.ok) return printError(result);
      const label = { active: '已上架 🚀', inactive: '已下架', draft: '已转草稿', archived: '已归档' }[target];
      console.log(`\n✅ 资产 ${uuid} ${label}\n`);
      break;
    }
    case 'featured':
    case 'unfeatured': {
      const uuid = args[1];
      if (!uuid) return console.error(`❌ 请指定资产 UUID: jzd-ops marketplace ${sub} <uuid>`);
      const on = sub === 'featured';
      const result = await mp.setFeatured(uuid, on);
      if (!result.ok) return printError(result);
      console.log(`\n✅ 资产 ${uuid} ${on ? '已设为精选 ⭐' : '已取消精选'}\n`);
      break;
    }
    case 'remove': {
      const uuid = args[1];
      if (!uuid) return console.error('❌ 请指定资产 UUID: jzd-ops marketplace remove <uuid>');
      const confirm = opts.yes === true || opts.yes === 'true';
      if (!confirm) {
        console.log('\n⚠️  删除不可恢复，确认请加 --yes');
        return;
      }
      const result = await mp.remove(uuid);
      if (!result.ok) return printError(result);
      console.log(`\n✅ 资产 ${uuid} 已删除\n`);
      break;
    }
    case 'categories': {
      const result = await mp.categories();
      if (!result.ok) return printError(result);
      console.log('\n🗂️  应用市场类目聚合:\n');
      for (const c of (result.items || [])) {
        console.log(`  [${ASSET_TYPE_LABELS[c.type] || c.type}] ${c.category} (${c.count})`);
      }
      console.log();
      break;
    }
    default:
      console.error(`
应用市场子命令:
  jzd-ops marketplace list [--type app|skill|mcp|prompt|employee|plugin|template] [--status] [--keyword] [--sort] [--admin]
  jzd-ops marketplace stats
  jzd-ops marketplace get <uuid>
  jzd-ops marketplace create --name "名称" --type app --slug xxx [--description] [--icon] [--category] [--priceType free|points|paid] [--price] [--featured]
  jzd-ops marketplace update <uuid> --name "新名称" [--description] [--price] [--category] ...
  jzd-ops marketplace publish <uuid>    上架
  jzd-ops marketplace unpublish <uuid>  下架
  jzd-ops marketplace draft <uuid>      转草稿
  jzd-ops marketplace featured <uuid>   设置精选
  jzd-ops marketplace unfeatured <uuid> 取消精选
  jzd-ops marketplace remove <uuid> --yes  删除
  jzd-ops marketplace categories
`);
  }
}

// ===== 健康检查 =====

async function handleHealth() {
  const client = getClient();
  const result = await client.healthCheck();
  const config = client.getConfig();

  console.log(`\n🔍 觉知岛 API 连接诊断\n`);
  console.log(`  API 地址: ${config.baseUrl}`);
  console.log(`  认证令牌: ${config.authToken ? '✅ 已设置' : '❌ 未设置'}`);
  console.log(`  DAO ID:   ${config.daoId ? `✅ ${config.daoId}` : '❌ 未设置'}`);

  if (result.ok) {
    console.log(`  连接状态: ✅ 正常 (${result.message})`);
  } else {
    console.log(`  连接状态: ❌ 失败`);
    console.log(`  错误: ${result.message}`);
  }
  console.log();
}

// ===== 工具函数 =====

function printError(result) {
  console.error(`\n❌ 操作失败:`);
  if (result.error) {
    console.error(`   类型: ${result.error.kind}`);
  }
  console.error(`   消息: ${result.message}`);
  console.error();
}

main().catch((err) => {
  console.error('❌ 运行错误:', err.message);
  process.exit(1);
});
