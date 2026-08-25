#!/usr/bin/env node
/**
 * Smoke tests for clawdao-jzd-agent
 * - 验证 lib/ 所有模块可加载（不要求真网络调用）
 * - 验证 CLI 可启动并打印 usage
 * - 验证 JzdClient 配置解析（不需要 DDN_HUB_* 也能 fail soft）
 *
 * 运行：node tests/smoke.mjs
 *      或 npm run test:smoke
 */

import { JzdClient } from '../lib/client.mjs';
import { ArticleManager } from '../lib/articles.mjs';
import { CourseManager } from '../lib/courses.mjs';
import { FeedbackManager } from '../lib/feedback.mjs';
import { MarketplaceManager } from '../lib/marketplace.mjs';
import { VersionManager, KNOWN_PRODUCT_IDS, emptyReleaseNotes, buildZhNotes } from '../lib/versions.mjs';

let passed = 0;
let failed = 0;

function ok(name) {
  passed++;
  console.log(`  ✓ ${name}`);
}
function fail(name, err) {
  failed++;
  console.error(`  ✗ ${name}: ${err && err.message ? err.message : err}`);
}

console.log('🧪 clawdao-jzd-agent smoke tests\n');

// 1. 所有 lib 模块可加载
console.log('[1/4] 模块加载');
try { JzdClient; ok('JzdClient 加载'); } catch (e) { fail('JzdClient', e); }
try { ArticleManager; ok('ArticleManager 加载'); } catch (e) { fail('ArticleManager', e); }
try { CourseManager; ok('CourseManager 加载'); } catch (e) { fail('CourseManager', e); }
try { FeedbackManager; ok('FeedbackManager 加载'); } catch (e) { fail('FeedbackManager', e); }
try { MarketplaceManager; ok('MarketplaceManager 加载'); } catch (e) { fail('MarketplaceManager', e); }
try { VersionManager; ok('VersionManager 加载'); } catch (e) { fail('VersionManager', e); }

// 2. 工具函数
console.log('\n[2/4] 工具函数');
try {
  const notes = emptyReleaseNotes();
  if (notes.zh.length === 0 && notes.en.length === 0) ok('emptyReleaseNotes 返回空对象');
  else fail('emptyReleaseNotes', '应返回 {zh:[],en:[]}');
} catch (e) { fail('emptyReleaseNotes', e); }

try {
  const out = buildZhNotes('<h2>x</h2>');
  if (Array.isArray(out) && out[0] === '<h2>x</h2>') ok('buildZhNotes(string) 包装为数组');
  else fail('buildZhNotes', '未正确包装');
} catch (e) { fail('buildZhNotes(string)', e); }

try {
  const out = buildZhNotes(['<a>', '<b>']);
  if (out.length === 2 && out[0] === '<a>') ok('buildZhNotes(array) 保留原数组');
  else fail('buildZhNotes(array)', '未保留');
} catch (e) { fail('buildZhNotes(array)', e); }

// 3. KNOWN_PRODUCT_IDS
console.log('\n[3/4] KNOWN_PRODUCT_IDS');
try {
  if (KNOWN_PRODUCT_IDS.clawdao && /^[0-9a-f-]{36}$/.test(KNOWN_PRODUCT_IDS.clawdao)) {
    ok(`clawdao UUID 格式正确: ${KNOWN_PRODUCT_IDS.clawdao}`);
  } else {
    fail('KNOWN_PRODUCT_IDS.clawdao', '格式错误');
  }
} catch (e) { fail('KNOWN_PRODUCT_IDS.clawdao', e); }

// 4. JzdClient fail-soft（无效 base_url 不崩溃）
console.log('\n[4/4] JzdClient fail-soft');
try {
  const client = new JzdClient({ baseUrl: 'not-a-valid-url' });
  const snap = client.getRuntimeSnapshot();
  if (snap && snap.baseUrlValid === false) ok('明显无效的 baseUrl 被标记为 baseUrlValid:false');
  else fail('JzdClient baseUrl validation', '未标记为 invalid');
} catch (e) { fail('JzdClient baseUrl', e); }

try {
  const client = new JzdClient();
  const snap = client.getRuntimeSnapshot();
  if (snap && snap.baseUrl === 'https://ddn.net') ok('默认 baseUrl = https://ddn.net');
  else fail('JzdClient default baseUrl', `got ${snap && snap.baseUrl}`);
} catch (e) { fail('JzdClient default', e); }

// 5. VersionManager 验证（不调 API）
try {
  const vm = new VersionManager({ baseUrl: 'http://localhost' });
  const r = await vm.create({ productId: '', version: '' });
  if (!r.ok && r.error && r.error.kind === 'validation') ok('create 拒绝空 productId');
  else fail('create validation', '应拒绝空 productId');
} catch (e) { fail('create validation', e); }

try {
  const vm = new VersionManager({ baseUrl: 'http://localhost' });
  const r = await vm.syncFromS3({ productKey: '', version: '' });
  if (!r.ok && r.error && r.error.kind === 'validation') ok('syncFromS3 拒绝空参数');
  else fail('syncFromS3 validation', '应拒绝空参数');
} catch (e) { fail('syncFromS3 validation', e); }

// platformToken 加载
try {
  const client = new JzdClient({ authToken: 'dao-tok', platformToken: 'platform-tok' });
  const snap = client.getRuntimeSnapshot();
  if (snap.hasAuthToken && snap.hasPlatformToken) ok('JzdClient 同时加载 auth + platform token');
  else fail('platform token loading', `hasAuth=${snap.hasAuthToken} hasPlatform=${snap.hasPlatformToken}`);
} catch (e) { fail('JzdClient platform token', e); }

// release() 走完整流程（不用真发布，只验证 schema）
try {
  const vm = new VersionManager({ baseUrl: 'http://localhost' });
  const r = await vm.release({});
  if (!r.ok && r.error && r.error.kind === 'validation') ok('release 拒绝空 productKey');
  else fail('release validation', '应拒绝');
} catch (e) { fail('release validation', e); }

// mdToHtml 转换器
try {
  const { mdToHtml, buildZhNotesFromMd, escapeHtml } = await import('../lib/versions.mjs');
  const md = `# 一级标题
## 二级标题
### 三级标题
这是普通段落包含 **加粗** 和 *斜体* 和 \`代码\`。

> 这是一个 blockquote。

- item 1
- item 2
  - nested（不支持但不会崩溃）

1. ordered 1
2. ordered 2

| 列1 | 列2 |
|-----|-----|
| a   | b   |
| c   | d   |

---`;
  const html = mdToHtml(md);
  const required = ['<h2>', '<h3>', '<h4>', '<strong>', '<em>', '<code>', '<blockquote>', '<ul>', '<ol>', '<table>', '<hr'];
  const missing = required.filter((tag) => !html.includes(tag));
  if (missing.length === 0) ok(`mdToHtml 覆盖 11 种语法（h2/h3/h4/strong/em/code/bq/ul/ol/table/hr）`);
  else fail('mdToHtml 覆盖', `缺失: ${missing.join(',')}`);

  // HTML 字符串不应该被转换
  const rawHtml = '<h2>v1.0.26 更新说明</h2><p>已有 html</p>';
  const passthrough = buildZhNotesFromMd(rawHtml);
  if (passthrough[0] === rawHtml) ok('buildZhNotesFromMd 识别 HTML 不转');
  else fail('buildZhNotesFromMd HTML', passthrough[0]);

  // MD 字符串应该转换
  const fromMd = buildZhNotesFromMd('## Hello');
  if (fromMd[0].includes('<h3>')) ok('buildZhNotesFromMd MD→HTML');
  else fail('buildZhNotesFromMd MD', fromMd[0]);

  // escapeHtml 不出错
  const esc = escapeHtml('<script>alert("xss")</script>');
  if (esc.includes('&lt;script&gt;') && !esc.includes('<script>')) ok('escapeHtml 防 XSS');
  else fail('escapeHtml', esc);

  // normalizeReleaseNotes 5 种输入
  const { normalizeReleaseNotes } = await import('../lib/versions.mjs');
  const cases = [
    ['MD string → HTML', '# Hi', '<h2>Hi</h2>'],
    ['HTML string 不变', '<h2>Hi</h2>', '<h2>Hi</h2>'],
    ['{zh,en} 提取 zh', { zh: ['<h2>X</h2>'], en: [] }, '<h2>X</h2>'],
    ['null → 空', null, ''],
    ['array → join', ['<h2>X</h2>'], '<h2>X</h2>'],
  ];
  let normalizePass = 0;
  for (const [name, input, expected] of cases) {
    const got = normalizeReleaseNotes(input);
    if (got === expected) { normalizePass++; }
    else console.log(`     [normalize] ${name}: 期望 ${JSON.stringify(expected)}, 实际 ${JSON.stringify(got)}`);
  }
  if (normalizePass === cases.length) ok(`normalizeReleaseNotes 5 种输入`);
  else fail('normalizeReleaseNotes', `${normalizePass}/${cases.length} pass`);
} catch (e) { fail('mdToHtml 测试', e); }

// 总结
console.log(`\n${failed === 0 ? '🎉' : '⚠️'}  ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);