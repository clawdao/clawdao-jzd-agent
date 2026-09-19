#!/usr/bin/env node

/**
 * 觉知岛运营助手 CLI
 * 用法: jzd <command> [options]
 *
 * 命令:
 *   article    文章管理（上传、列表、发布）
 *   course     课程管理（上传、列表、发布）
 *   feedback   提交反馈
 *   health     健康检查
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';
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

/** 从本地文件读取文章正文；失败时抛出友好错误 */
function readContentFile(p) {
  const abs = resolve(process.cwd(), p);
  try {
    return readFileSync(abs, 'utf-8');
  } catch (e) {
    throw new Error(`❌ --content-file 读取失败: ${abs}\n   ${e.message}`);
  }
}

import { JzdClient } from '../lib/client.mjs';
import { ArticleManager, POST_TYPES, POST_TYPE_LABELS, DEFAULT_POST_TYPE } from '../lib/articles.mjs';
import { CourseManager } from '../lib/courses.mjs';
import { FeedbackManager } from '../lib/feedback.mjs';
import { MarketplaceManager, ASSET_TYPES, ASSET_TYPE_LABELS, ASSET_STATUSES, PRICE_TYPE_LABELS } from '../lib/marketplace.mjs';
import { VersionManager, KNOWN_PRODUCT_IDS } from '../lib/versions.mjs';
import { MaterialManager, MATERIAL_TYPES, MATERIAL_TYPE_LABELS } from '../lib/materials.mjs';

const COMMANDS = {
  article: '文章管理：list, create, publish, delete',
  course: '课程管理：list, create, publish, delete, categories',
  feedback: '提交反馈或查看反馈列表',
  marketplace: '应用市场：list, stats, get, create, update, publish, remove, categories',
  version: '产品版本发布：list, get, create, release, sync-s3, publish, manifest, remove, summary, health',
  upload: '上传素材（图片/视频/文件）到觉知岛素材库',
  health: '检查 API 服务状态',
};

function printUsage() {
  console.log(`
╔══════════════════════════════════════════╗
║       觉知岛运营助手 (jzd)          ║
║     DDN Hub 运营操作 CLI 工具           ║
╚══════════════════════════════════════════╝

用法: jzd <command> [子命令] [选项]

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

  version list         列出产品版本（--product-key clawdao）
  version get          <uuid> 查看版本详情
  version create       创建版本（--notes '<h2>更新说明</h2>...'）
  version release      一键发布（创建 + 同步 S3）
  version sync-s3      从 S3 同步资产到版本（--product-key --version）
  version publish      <uuid> 发布版本
  version manifest     <uuid> Manifest 预览（--action generate）
  version summary      --product-key <key>  发布摘要
  version health       Download-assets 健康检查
  version remove       <uuid> 删除版本（--force 硬删）

  upload <file>...    上传一个或多个本地文件到素材库
                       --type image|video|file（默认 image）
                       --json        输出机器可读 JSON（供脚本拼装）
                       --json-only   仅输出 URL（每行一个）

  health              检查 API 连接

环境变量:
  DDN_HUB_BASE_URL    API 地址（默认: https://ddn.net）
  DDN_HUB_AUTH_TOKEN  认证令牌
  DDN_HUB_DAO_ID      DAO ID

示例:
  jzd health
  jzd article list --postType news
  jzd article create --title "标题" --content "内容" --postType news
  jzd article publish 42
  jzd article upload --title "T" --content "C" --publish
  jzd course list
  jzd course create --title "课程名"
  jzd feedback submit --title "建议" --content "详情"
  jzd upload ./cover.png              # 上传单张图片
  jzd upload ./a.png ./b.png          # 批量上传（去重）
  jzd upload ./a.png --json           # JSON 输出（拼装给 --images 用）
`);
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        options[key] = args[i + 1];
        options[camelKey] = args[i + 1];
        i++;
      } else {
        options[key] = true;
        options[camelKey] = true;
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
    case 'version':
      await handleVersion(args.slice(1));
      break;
    case 'upload':
      await handleUpload(args.slice(1));
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
      // ★ postType 白名单校验（仅当用户显式传了值时）
      if (opts.postType && !POST_TYPES.includes(opts.postType)) {
        return console.error(`❌ --postType "${opts.postType}" 不合法。合法值：${POST_TYPES.map((t) => `${t}(${POST_TYPE_LABELS[t]})`).join(' / ')}`);
      }
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
        const ptLabel = POST_TYPE_LABELS[item.postType] || item.postType || '未分类';
        console.log(`  [${item.id}] ${item.title || '(无标题)'}`);
        console.log(`        类型: ${ptLabel} | 状态: ${item.status} | 更新: ${item.updatedAt || '-'}`);
        console.log();
      }
      break;
    }
    case 'create': {
      if (!opts.title) return console.error('❌ 请指定 --title');
      // ★ postType 白名单校验（ddn-hub 升级后只有 news / help / article）
      const createPostType = opts.postType || DEFAULT_POST_TYPE;
      if (!POST_TYPES.includes(createPostType)) {
        return console.error(`❌ --postType "${opts.postType}" 不合法。合法值：${POST_TYPES.map((t) => `${t}(${POST_TYPE_LABELS[t]})`).join(' / ')}`);
      }
      let extraData;
      try { if (opts.extraData) extraData = JSON.parse(opts.extraData); }
      catch (e) { return console.error('❌ --extra-data 必须是合法 JSON: ' + e.message); }
      let tags;
      if (opts.tags) tags = opts.tags.split(',').map(s => s.trim()).filter(Boolean);
      const result = await article.create({
        title: opts.title,
        content: opts.content || opts.body,
        contentMarkdown: opts.contentFile ? readContentFile(opts.contentFile) : undefined,
        postType: createPostType,
        summary: opts.summary,
        description: opts.description,
        categoryId: opts.categoryId ? parseInt(opts.categoryId, 10) : undefined,
        tags,
        coverImage: opts.coverImage,
        extraData,
        body: opts.body,
      });
      if (!result.ok) return printError(result);
      const id = result.data?.id;
      console.log(`\n✅ 草稿已创建 (ID: ${id})`);
      console.log(`   标题: ${opts.title}`);
      console.log(`   类型: ${createPostType} (${POST_TYPE_LABELS[createPostType]})`);
      console.log(`   发布: jzd article publish ${id}\n`);
      break;
    }
    case 'publish': {
      const postId = args[1];
      if (!postId || isNaN(parseInt(postId))) return console.error('❌ 请指定文章 ID: jzd article publish <postId>');
      const result = await article.publish(parseInt(postId));
      if (!result.ok) return printError(result);
      console.log(`\n✅ 文章 ${postId} 已发布\n`);
      break;
    }
    case 'upload': {
      if (!opts.title) return console.error('❌ 请指定 --title');
      // ★ postType 白名单校验（ddn-hub 升级后只有 news / help / article）
      const uploadPostType = opts.postType || DEFAULT_POST_TYPE;
      if (!POST_TYPES.includes(uploadPostType)) {
        return console.error(`❌ --postType "${opts.postType}" 不合法。合法值：${POST_TYPES.map((t) => `${t}(${POST_TYPE_LABELS[t]})`).join(' / ')}`);
      }
      const shouldPublish = opts.publish === true || opts.publish === 'true';
      let extraData;
      try { if (opts.extraData) extraData = JSON.parse(opts.extraData); }
      catch (e) { return console.error('❌ --extra-data 必须是合法 JSON: ' + e.message); }
      let tags;
      if (opts.tags) tags = opts.tags.split(',').map(s => s.trim()).filter(Boolean);
      const result = await article.upload({
        title: opts.title,
        content: opts.content || opts.body,
        contentMarkdown: opts.contentFile ? readContentFile(opts.contentFile) : undefined,
        postType: uploadPostType,
        summary: opts.summary,
        description: opts.description,
        categoryId: opts.categoryId ? parseInt(opts.categoryId, 10) : undefined,
        tags,
        coverImage: opts.coverImage,
        extraData,
        publish: shouldPublish,
      });
      if (!result.ok) return printError(result);
      console.log(`\n✅ ${result.message}`);
      if (result.data?.postId) {
        console.log(`   ID: ${result.data.postId}`);
        console.log(`   类型: ${uploadPostType} (${POST_TYPE_LABELS[uploadPostType]})`);
      }
      console.log();
      break;
    }
    default:
      console.error(`
文章管理子命令:
  jzd article list [--postType ${POST_TYPES.join('|')}] [--status draft] [--search keyword]
  jzd article create --title "标题" [--content "内容"|--content-file path] [--postType ${POST_TYPES.join('|')}] \
                   [--description "简介"] [--tags "a,b,c"] [--cover-image URL] \
                   [--category-id 12] [--extra-data '{"category":"模型","subcategory":"指南"}']
  jzd article publish <postId>
  jzd article upload --title "标题" [--content "内容"|--content-file path] [--publish] \
                   [--postType ${POST_TYPES.join('|')}] \
                   [--description "简介"] [--tags "a,b,c"] [--cover-image URL] \
                   [--category-id 12] [--extra-data '{"category":"模型","subcategory":"指南"}']

postType 取值（ddn-hub 升级后）:
  ${POST_TYPES.map((t) => `  - ${t.padEnd(8)} ${POST_TYPE_LABELS[t]}`).join('\n')}
  默认: ${DEFAULT_POST_TYPE}
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
      console.log(`   发布: jzd course publish ${id}\n`);
      break;
    }
    case 'publish': {
      const courseId = args[1];
      if (!courseId) return console.error('❌ 请指定课程 ID: jzd course publish <courseId>');
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
  jzd course list [--keyword xxx] [--status published]
  jzd course create --title "课程名" [--description "描述"] [--price 0] [--publish]
  jzd course publish <courseId>
  jzd course upload --title "课程名" --description "描述" [--publish]
  jzd course categories
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
  jzd feedback submit --title "反馈标题" [--content "详情"] [--type suggestion|bug|feature]
  jzd feedback list [--type suggestion]
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
      if (!uuid) return console.error('❌ 请指定资产 UUID: jzd marketplace get <uuid>');
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
      console.log(`   上架: jzd marketplace publish ${a.uuid || ''}\n`);
      break;
    }
    case 'update': {
      const uuid = args[1];
      if (!uuid) return console.error('❌ 请指定资产 UUID: jzd marketplace update <uuid> --name "新名称"');
      const updates = {};
      for (const f of ['type', 'slug', 'name', 'description', 'icon', 'category', 'author', 'version', 'sourceUrl', 'configUrl', 'priceType', 'license']) {
        if (opts[f] !== undefined) updates[f] = opts[f];
      }
      if (opts.price !== undefined) updates.price = parseFloat(opts.price);
      if (opts.pointsCost !== undefined) updates.pointsCost = parseInt(opts.pointsCost);
      if (opts.tags !== undefined) updates.tags = opts.tags.split(',').map((s) => s.trim()).filter(Boolean);
      if (opts.featured === 'true' || opts.featured === true) updates.isFeatured = true;
      if (opts.featured === 'false') updates.isFeatured = false;
      // README 支持两种方式：直接传 markdown 文本，或传文件路径（@file 语法）
      if (opts.readme !== undefined) {
        const v = String(opts.readme);
        if (v.startsWith('@')) {
          const fp = v.slice(1);
          if (!existsSync(fp)) {
            return console.error(`❌ README 文件不存在: ${fp}`);
          }
          updates.readme = readFileSync(fp, 'utf-8');
        } else {
          updates.readme = v;
        }
      }
      if (Object.keys(updates).length === 0) {
        return console.error('❌ 没有需要更新的字段，例如: --name / --description / --price / --category / --readme / --license');
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
      if (!uuid) return console.error(`❌ 请指定资产 UUID: jzd marketplace ${sub} <uuid>`);
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
      if (!uuid) return console.error(`❌ 请指定资产 UUID: jzd marketplace ${sub} <uuid>`);
      const on = sub === 'featured';
      const result = await mp.setFeatured(uuid, on);
      if (!result.ok) return printError(result);
      console.log(`\n✅ 资产 ${uuid} ${on ? '已设为精选 ⭐' : '已取消精选'}\n`);
      break;
    }
    case 'remove': {
      const uuid = args[1];
      if (!uuid) return console.error('❌ 请指定资产 UUID: jzd marketplace remove <uuid>');
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
  jzd marketplace list [--type app|skill|mcp|prompt|employee|plugin|template] [--status] [--keyword] [--sort] [--admin]
  jzd marketplace stats
  jzd marketplace get <uuid>
  jzd marketplace create --name "名称" --type app --slug xxx [--description] [--icon] [--category] [--priceType free|points|paid] [--price] [--featured]
  jzd marketplace update <uuid> --name "新名称" [--description] [--price] [--category] ...
  jzd marketplace publish <uuid>    上架
  jzd marketplace unpublish <uuid>  下架
  jzd marketplace draft <uuid>      转草稿
  jzd marketplace featured <uuid>   设置精选
  jzd marketplace unfeatured <uuid> 取消精选
  jzd marketplace remove <uuid> --yes  删除
  jzd marketplace categories
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

// ===== 产品版本发布 =====

async function handleVersion(args) {
  const subcommand = args[0];
  const opts = parseArgs(args.slice(1));
  const client = new JzdClient();
  const vm = new VersionManager(client);

  switch (subcommand) {
    case 'list': {
      const productKey = opts.productKey || opts.product;
      const productId = opts.productId || (productKey && KNOWN_PRODUCT_IDS[productKey]);
      if (!productKey && !productId) {
        console.error('❌ 需要 --product-key 或 --product-id（已知 productKey：' + Object.keys(KNOWN_PRODUCT_IDS).join(', ') + '）');
        process.exit(2);
      }
      const result = await vm.list({ productId, productKey, status: opts.status, releaseSource: opts.source, page: parseInt(opts.page || '1'), pageSize: parseInt(opts.pageSize || '20') });
      printListResult(result, '版本', (v) => `  [${v.version || '?'}] ${v.title || ''}\n        id=${v.id} | status=${v.status} | isLatest=${v.isLatest} | assets=${(v.assets||[]).length}\n        releaseAt=${v.releaseAt || v.createdAt || ''}`);
      break;
    }
    case 'get': {
      if (!opts.id) { console.error('❌ 需要 --id <versionId>'); process.exit(2); }
      const result = await vm.get(opts.id);
      if (result.ok) printDetailResult(result, '版本', (v) => `  ${v.version} (${v.status}) - isLatest=${v.isLatest}\n  UUID: ${v.id}\n  productId: ${v.productId}\n  releaseAt: ${v.releaseAt}\n  assets: ${(v.assets||[]).length} 个`);
      else printError(result);
      break;
    }
    case 'create': {
      // 整理版本字段 → POST 创建
      if (!opts.version) { console.error('❌ 需要 --version（如 1.0.27）'); process.exit(2); }
      const productId = opts.productId || (opts.productKey && KNOWN_PRODUCT_IDS[opts.productKey]);
      if (!productId) { console.error('❌ 需要 --product-key 或 --product-id'); process.exit(2); }
      const releaseNotes = opts.notes
        ? { zh: [opts.notes], en: [] }
        : (opts.notesFile
          ? { zh: [readFileSync(opts.notesFile, 'utf-8')], en: [] }
          : undefined);
      const result = await vm.create({
        productId,
        version: opts.version,
        title: opts.title,
        releaseNotes,
        isPrerelease: opts.prerelease === 'true' || opts.prerelease === true,
        isLatest: opts.latest !== 'false' && opts.latest !== false,
        releaseSource: opts.source || 'manual',
      });
      if (result.ok) {
        console.log(`✅ 版本创建成功`);
        console.log(`   id:      ${result.data?.id}`);
        console.log(`   version: ${result.data?.version}`);
        console.log(`   status:  ${result.data?.status || 'draft'}`);
      } else {
        printError(result);
      }
      break;
    }
    case 'sync-s3': {
      // 同步 S3 资产到产品版本（“同步s3”按钮后端）
      if (!opts.productKey) { console.error('❌ 需要 --product-key（如 clawdao）'); process.exit(2); }
      if (!opts.version) { console.error('❌ 需要 --version（如 1.0.27）'); process.exit(2); }
      console.log(`☁️  同步 S3 → productKey=${opts.productKey} version=${opts.version}${opts.dryRun === 'true' ? ' (DRY-RUN)' : ''}`);
      const result = await vm.syncFromS3({
        productKey: opts.productKey,
        version: opts.version,
        prefix: opts.prefix,
        dryRun: opts.dryRun === 'true' || opts.dryRun === true,
      });
      if (result.ok) {
        console.log(`✅ S3 同步成功`);
        console.log(`   message: ${result.message}`);
        if (result.data) console.log(`   data:    ${JSON.stringify(result.data, null, 2)}`);
      } else {
        printError(result);
      }
      break;
    }
    case 'publish': {
      if (!opts.id) { console.error('❌ 需要 --id <versionId>'); process.exit(2); }
      const result = await vm.publish(opts.id);
      if (result.ok) console.log(`✅ 版本 ${opts.id} 已发布`);
      else printError(result);
      break;
    }
    case 'manifest': {
      const action = opts.action || 'preview';
      if (!opts.id) { console.error('❌ 需要 --id <versionId>'); process.exit(2); }
      const result = action === 'generate'
        ? await vm.generateManifest(opts.id)
        : await vm.previewManifest(opts.id);
      if (result.ok) {
        console.log(`✅ Manifest ${action === 'generate' ? '已生成' : '预览'}：`);
        console.log(JSON.stringify(result.data, null, 2));
      } else printError(result);
      break;
    }
    case 'summary': {
      if (!opts.productKey) { console.error('❌ 需要 --product-key'); process.exit(2); }
      const result = await vm.downloadSummary(opts.productKey);
      if (result.ok) console.log(JSON.stringify(result.data, null, 2));
      else printError(result);
      break;
    }
    case 'health': {
      const result = await vm.healthCheck();
      if (result.ok) console.log(`✅ Download-assets 服务健康: ${result.message}`);
      else printError(result);
      break;
    }
    case 'release': {
      // 一键完整流程：整理字段 + POST 创建 + 同步 S3
      if (!opts.version) { console.error('❌ 需要 --version'); process.exit(2); }
      const productKey = opts.productKey || 'clawdao';
      const productId = opts.productId || KNOWN_PRODUCT_IDS[productKey];
      if (!productId) { console.error(`❌ 未知 productKey "${productKey}"，请用 --product-id`); process.exit(2); }
      const releaseNotes = opts.notes
        ? { zh: [opts.notes], en: [] }
        : opts.notesFile
          ? { zh: [readFileSync(opts.notesFile, 'utf-8')], en: [] }
          : undefined;
      console.log(`🚀 一键发布流程`);
      console.log(`   productKey: ${productKey}`);
      console.log(`   version:    ${opts.version}`);
      console.log(`   syncS3:     ${opts['no-sync'] ? '否' : '是'}`);
      const result = await vm.release({
        productKey,
        productId,
        version: opts.version,
        title: opts.title,
        releaseNotes,
        isPrerelease: opts.prerelease === 'true',
        syncS3: !opts['no-sync'],
        s3Prefix: opts.prefix,
        dryRun: opts.dryRun === 'true',
      });
      if (result.ok) {
        console.log(`✅ 发布流程完成`);
        for (const s of result.steps) console.log(`   [${s.ok ? '✓' : '✗'}] ${s.step}: ${s.message}`);
        if (result.versionId) console.log(`   versionId: ${result.versionId}`);
      } else {
        console.error(`❌ 发布流程失败于某个环节`);
        for (const s of result.steps) console.error(`   [${s.ok ? '✓' : '✗'}] ${s.step}: ${s.message}`);
        printError(result);
      }
      break;
    }
    case 'remove':
    case 'rm': {
      if (!opts.id) { console.error('❌ 需要 --id'); process.exit(2); }
      const result = opts.force === 'true'
        ? await vm.removeForce(opts.id)
        : await vm.remove(opts.id);
      if (result.ok) console.log(`✅ 版本 ${opts.id} 已删除${opts.force === 'true' ? '（硬删）' : ''}`);
      else printError(result);
      break;
    }
    default:
      console.log(`
产品版本发布（jzd version）：

  jzd version list                       列出版本（--product-key clawdao）
  jzd version get --id <uuid>            版本详情
  jzd version create                     创建版本
       --product-key clawdao --version 1.0.27
       --notes '<h2>v1.0.27 更新说明</h2>...' （HTML 字符串）
       [--notes-file <path>] （从文件读取，适合长 md）
       [--title '标题'] [--prerelease true]
  jzd version release                    一键发布（创建 + 同步 S3）
       --product-key clawdao --version 1.0.27
       --notes '...' [--notes-file <path>] [--no-sync]
  jzd version sync-s3                    同步 S3 资产到版本（“同步s3”按钮）
       --product-key clawdao --version 1.0.27
       [--prefix path/] [--dryRun true]
  jzd version publish --id <uuid>        发布版本
  jzd version manifest --id <uuid>       Manifest 预览（--action generate 生成）
  jzd version summary --product-key X    发布摘要
  jzd version health                     Download-assets 健康检查
  jzd version remove --id <uuid>         删除（--force 硬删）

已知 productKey：${Object.keys(KNOWN_PRODUCT_IDS).join(', ')}
`);
  }
}

// ===== 素材上传 =====

async function handleUpload(args) {
  // 支持两种调用形态：
  //   jzd upload <file1> [file2 ...] [--type image] [--json] [--json-only] [--filename <name>]
  //   jzd upload --check                 （仅健康检查）
  const opts = parseArgs(args);
  const files = [];
  for (const a of args) {
    if (a.startsWith('--')) break;
    files.push(a);
  }

  const mm = new MaterialManager(getClient());

  // 健康检查模式
  if (opts.check === true || opts.check === 'true') {
    const h = mm.health();
    console.log(`\n🩺 素材上传健康检查\n`);
    if (h.ok) {
      console.log(`  ✅ ${h.message}`);
      console.log(`  baseUrl: ${h.config.baseUrl}`);
      console.log(`  auth:    ${h.config.hasAuthToken ? '已设置' : '❌'}`);
      console.log(`  dao:     ${h.config.hasDaoId ? h.config.daoId : '❌'}`);
    } else {
      console.log(`  ❌ ${h.message}`);
    }
    console.log();
    process.exit(h.ok ? 0 : 1);
  }

  if (files.length === 0) {
    console.error(`❌ 请指定要上传的文件路径，例如: jzd upload ./cover.png`);
    console.error(`   支持 image / video / file，通过 --type 选择（默认 image）`);
    console.error(`   可选 --json 输出结构化结果，--json-only 仅输出 URL 列表`);
    process.exit(2);
  }

  const type = (typeof opts.type === 'string' && opts.type) || 'image';
  if (!MATERIAL_TYPES.includes(type)) {
    console.error(`❌ --type 必须是 ${MATERIAL_TYPES.join(' / ')}`);
    process.exit(2);
  }

  const wantJson = opts.json === true || opts.json === 'true';
  const wantJsonOnly = opts['json-only'] === true || opts['json-only'] === 'true';

  // 批量上传（自动去重）
  const result = await mm.uploadBatch(files, { type });

  if (wantJsonOnly) {
    // 仅打印 URL，每行一个；失败时按 stderr 输出，最后用退出码区分
    for (const url of result.map.values()) console.log(url);
    for (const f of result.failures) console.error(`❌ ${f.path}: ${f.message}`);
    process.exit(result.failures.length === 0 ? 0 : 1);
  }

  if (wantJson) {
    // JSON 输出（含 ok + map + failures），便于 jq 处理或脚本拼装
    const payload = {
      ok: result.ok,
      message: result.message,
      type,
      count: result.map.size,
      files: Array.from(result.map.entries()).map(([path, url]) => ({ path, url })),
      failures: result.failures,
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  // 人类可读输出
  console.log(`\n📤 素材上传（type=${type}）\n`);
  for (const [path, url] of result.map.entries()) {
    console.log(`  ✅ ${basename(path)}`);
    console.log(`     ${path}`);
    console.log(`     → ${url}\n`);
  }
  for (const f of result.failures) {
    console.log(`  ❌ ${basename(f.path)}: ${f.message}`);
  }
  console.log(`  ${result.message}\n`);
  process.exit(result.ok ? 0 : 1);
}

// ===== 工具函数 =====

function printListResult(result, title, formatter) {
  if (!result.ok) { printError(result); return; }
  const items = result.items || [];
  console.log(`\n📋 ${title}列表（${result.total || items.length} 项）:\n`);
  if (items.length === 0) { console.log('  （空）\n'); return; }
  for (const item of items) console.log(formatter(item));
  if (result.totalPages && result.totalPages > 1) {
    console.log(`\n  📄 页 ${result.page || 1} / ${result.totalPages}（每页 ${result.pageSize || items.length}）`);
  }
  console.log();
}

function printDetailResult(result, title, formatter) {
  if (!result.ok) { printError(result); return; }
  console.log(`\n📦 ${title}详情：\n`);
  if (typeof result.data === 'object' && result.data !== null) {
    console.log(formatter(result.data));
  }
  console.log();
}

function printError(result) {
  console.error(`\n❌ 操作失败:`);
  if (result.error) {
    console.error(`   类型: ${result.error.kind}`);
  }
  // ★ 修复：message 为 undefined 时给出有意义兜底，而不是打印 'undefined'
  const msg = result.message || result.error?.message || '(未提供错误消息)';
  console.error(`   消息: ${msg}`);
  if (result.statusCode) console.error(`   HTTP 状态码: ${result.statusCode}`);
  console.error();
}

main().catch((err) => {
  console.error('❌ 运行错误:', err.message);
  process.exit(1);
});
