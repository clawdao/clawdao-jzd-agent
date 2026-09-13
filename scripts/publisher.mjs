#!/usr/bin/env node
/**
 * 通用文章发布器：把 markdown + 本地图片一键发布到觉知岛
 *
 * 用法：
 *   node scripts/publisher.mjs <markdown-file> \
 *     [--title "..."] [--category "帮助"] [--subcategory "..."] \
 *     [--difficulty beginner] [--accessType public] [--postType article] [--draft]
 *
 * 渲染机制：
 *   - 我们传 markdown 到 `contentMarkdown` 字段（同时传空 `content` 占位以满足 egg-validate）
 *   - ddn-hub 前端 PostDetail 用 MDXRenderer 渲染 `contentMarkdown` 或 `content`（如果是 markdown 形态）
 *   - 我们不自己写 markdown→HTML 转换（之前写过有 bug）
 *   - 图片走 s3.ddn.net（替换 markdown 里的相对路径）
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, '..', '.env');
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

const { ArticleManager } = await import('../lib/articles.mjs');
const { MaterialManager } = await import('../lib/materials.mjs');
const baseUrl = process.env.DDN_HUB_BASE_URL || 'https://ddn.net';
const token = process.env.DDN_HUB_AUTH_TOKEN;
const daoId = process.env.DDN_HUB_DAO_ID;

if (!token || !daoId) {
  console.error('❌ .env 缺 DDN_HUB_AUTH_TOKEN / DDN_HUB_DAO_ID');
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        opts[key] = argv[i + 1]; i++;
      } else {
        opts[key] = true;
      }
    } else {
      opts._.push(a);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const mdFile = opts._[0];
if (!mdFile) {
  console.error('用法: node scripts/publisher.mjs <markdown-file> [选项]');
  console.error('选项:');
  console.error('  --title "标题"          默认取 markdown 第一个 # 标题');
  console.error('  --category "帮助"       默认 "帮助"');
  console.error('  --subcategory "..."     默认 ""');
  console.error('  --difficulty beginner   默认 beginner');
  console.error('  --accessType public     默认 public');
  console.error('  --postType article      默认 article');
  console.error('  --draft                 仅创建草稿，不发布');
  process.exit(1);
}

const cfg = {
  title: opts.title || null,
  category: opts.category || '帮助',
  subcategory: opts.subcategory || '',
  difficulty: opts.difficulty || 'beginner',
  accessType: opts.accessType || 'public',
  postType: opts.postType || 'article',
  draft: opts.draft === true,
};

const mdPath = resolve(mdFile);
if (!existsSync(mdPath)) {
  console.error(`❌ 文件不存在: ${mdPath}`);
  process.exit(1);
}
const md = readFileSync(mdPath, 'utf-8');
const mdDir = dirname(mdPath);

const titleFromMd = md.match(/^# (.+)$/m)?.[1]?.trim();
const title = cfg.title || titleFromMd || basename(mdPath, '.md');

let description = '';
const quoteMatch = md.match(/^> (.+)$/m);
if (quoteMatch) description = quoteMatch[1].trim().replace(/\*\*/g, '');
else {
  const firstPara = md.replace(/^# .+$\n?/m, '').split(/\n\n+/)[0]?.trim();
  if (firstPara) description = firstPara.replace(/[#*`>]/g, '').trim().slice(0, 200);
}
if (!description) description = title;

console.log('═══════════════════════════════════════════════════════');
console.log(`📄 发布文章`);
console.log(`   来源: ${mdPath}`);
console.log(`   标题: ${title}`);
console.log(`   分类: ${cfg.category} / ${cfg.subcategory}`);
console.log(`   难度: ${cfg.difficulty} | 访问: ${cfg.accessType}`);
console.log(`   类型: ${cfg.postType} | 状态: ${cfg.draft ? 'draft' : 'published'}`);
console.log('═══════════════════════════════════════════════════════');

// 上传图片（通过 MaterialManager，自动去重 + 错误聚合）
const imgRefs = [...md.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
console.log(`\n🖼  发现 ${imgRefs.length} 张图片`);

const relPaths = [];
for (const m of imgRefs) {
  const rel = m[2];
  // 跳过已经是远程 URL 的图片（http/https 开头）
  if (/^https?:\/\//i.test(rel)) continue;
  if (!relPaths.includes(rel)) relPaths.push(rel);
}

// 预解析为绝对路径（MaterialManager 内部也会解析，但这里要单独打 warn）
const absPaths = [];
for (const rel of relPaths) {
  const abs = resolve(mdDir, rel);
  if (!existsSync(abs)) {
    console.warn(`   ⚠️  图片不存在: ${abs}`);
    continue;
  }
  absPaths.push(abs);
}

const material = new MaterialManager({ baseUrl, authToken: token, daoId });
const uploadResult = await material.uploadBatch(absPaths, { type: 'image' });

const imgUrlMap = new Map();
// 把上传成功的 URL 通过原始 markdown 相对路径索引回去
for (const rel of relPaths) {
  const abs = resolve(mdDir, rel);
  const url = uploadResult.map.get(abs);
  if (url) imgUrlMap.set(rel, url);
}
for (const f of uploadResult.failures) {
  console.warn(`   ⚠️  上传失败: ${basename(f.path)} — ${f.message}`);
}
console.log(`   ${imgUrlMap.size}/${relPaths.length} 张上传成功`);
if (imgUrlMap.size < relPaths.length) {
  console.error('❌ 部分图片上传失败，中止发布');
  process.exit(1);
}

// 替换 markdown 里的图片相对路径
let markdown = md;
markdown = markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, rel) => {
  const url = imgUrlMap.get(rel) || rel;
  return `![${alt}](${url})`;
});

console.log(`\n📝 markdown 长度: ${markdown.length} 字符`);

// 直接 PUT 调 ddn-hub，绕过 ArticleManager.create 的 content 必填检查
// contentMarkdown 是 server 端存的 markdown 原稿；content 字段传同一 markdown 字符串
//   满足 egg-validate 的 'min: 20'，前端 PostDetail 用 MDXRenderer 渲染 contentMarkdown
console.log('\n🚀 POST /api/v1/posts（contentMarkdown + 占位 content）...');
const createRes = await fetch(`${baseUrl}/api/v1/posts`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'X-Dao-Id': daoId,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    title,
    description,
    postType: cfg.postType,
    content: markdown.slice(0, 500) + (markdown.length > 500 ? '\n\n(完整 markdown 见 contentMarkdown 字段)' : ''), // 占位符（≥20字符）
    contentMarkdown: markdown,
    status: 'draft',
  }),
});
const createBody = await createRes.json();
console.log(`   status=${createRes.status}, ok=${createBody.status === 0}, id=${createBody.data?.id}, msg: ${createBody.msg || ''}`);

if (createBody.status !== 0 || !createBody.data?.id) {
  console.error('❌ 创建失败');
  process.exit(1);
}

const postId = createBody.data.id;

console.log(`\n🏷  写入分类: ${cfg.category} / ${cfg.subcategory}`);
const updateRes = await fetch(`${baseUrl}/api/v1/posts/${postId}`, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'X-Dao-Id': daoId,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    extraData: {
      category: cfg.category,
      subcategory: cfg.subcategory,
      difficulty: cfg.difficulty,
      accessType: cfg.accessType,
    },
  }),
});
const updateBody = await updateRes.json();
console.log(`   update: ok=${updateBody.status === 0} msg=${updateBody.msg || ''}`);
if (updateBody.status !== 0) {
  console.error('❌ 分类写入失败');
  process.exit(1);
}

if (cfg.draft) {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`✅ 草稿已创建（--draft，未发布）`);
  console.log(`   postId: ${postId}`);
  console.log(`   发布: jzd article publish ${postId}`);
  console.log('═══════════════════════════════════════════════════════');
  process.exit(0);
}

console.log('\n📢 发布...');
const article = new ArticleManager({ baseUrl, token, daoId });
const publishRes = await article.publish(postId);
console.log(`   publish: ok=${publishRes.ok} msg=${publishRes.message || ''}`);

if (!publishRes.ok) {
  console.error('❌ 发布失败');
  process.exit(1);
}

console.log('\n═══════════════════════════════════════════════════════');
console.log(`✅ 发布成功！`);
console.log(`   postId: ${postId}`);
console.log(`   标题: ${title}`);
console.log(`   分类: ${cfg.category} / ${cfg.subcategory}`);
console.log(`   图片: ${imgUrlMap.size} 张（s3.ddn.net）`);
console.log(`   访问: https://ddn.net/cms/post/${postId}`);
console.log('═══════════════════════════════════════════════════════');
