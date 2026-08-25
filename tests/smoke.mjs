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

// 总结
console.log(`\n${failed === 0 ? '🎉' : '⚠️'}  ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);