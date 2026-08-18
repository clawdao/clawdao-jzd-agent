#!/usr/bin/env node
/**
 * scripts/export-ddn-env.mjs — 从 ClawDao 桌面应用同步觉知岛凭证到 .env
 *
 * 数据源：~/Library/Application Support/net.ddn.clawdao/store.bin
 *   auth_state.ddnHub.{ authToken, baseUrl, daoId, daoName, username }
 *
 * 安全说明：
 *   - 不向终端打印 token 明文（只显示掩码如 "jwt_***3ab"）
 *   - 生成的 .env 权限设为 600（仅本用户可读写）
 *   - 配合 .gitignore 排除 .env，防止误提交
 *
 * 用法：node scripts/export-ddn-env.mjs [--force]
 */
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const ENV_PATH = resolve(process.cwd(), '.env');
const STORE_CANDIDATES = [
  resolve(homedir(), 'Library/Application Support/net.ddn.clawdao/store.bin'),
  resolve(homedir(), 'Library/Application Support/net.ddn.daoclaw/store.json'),
];

function findStore() {
  for (const p of STORE_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

function mask(value) {
  if (!value) return '(空)';
  if (value.length <= 8) return '***';
  return value.slice(0, 4) + '***' + value.slice(-3);
}

function load() {
  const storePath = findStore();
  if (!storePath) throw new Error('未找到 ClawDao store 文件');
  let raw;
  try {
    raw = readFileSync(storePath, 'utf-8');
  } catch (e) {
    throw new Error(`读取 ${storePath} 失败: ${e.message}`);
  }
  // store.json 直接是 JSON；store.bin 是 JSON 或带前缀文本
  let json = raw;
  try { json = JSON.parse(raw); } catch {
    const start = raw.indexOf('{');
    if (start < 0) throw new Error('store 文件不是 JSON 格式');
    json = JSON.parse(raw.slice(start));
  }
  const hub = json?.auth_state?.ddnHub;
  if (!hub?.authToken) throw new Error('store 中没有 auth_state.ddnHub.authToken（ClawDao 可能未登录觉知岛）');
  return {
    storePath,
    authToken: String(hub.authToken),
    baseUrl: String(hub.baseUrl || 'https://ddn.net'),
    daoId: String(hub.daoId || ''),
    daoName: String(hub.daoName || ''),
    username: String(hub.username || ''),
  };
}

const force = process.argv.includes('--force');
if (!force && existsSync(ENV_PATH)) {
  console.log('⚠️  .env 已存在，跳过（如需覆盖请加 --force）');
  process.exit(0);
}

try {
  const info = load();
  const lines = [
    '# 由 scripts/export-ddn-env.mjs 自动生成（' + new Date().toISOString() + '）',
    `DDN_HUB_BASE_URL=${info.baseUrl}`,
    `DDN_HUB_AUTH_TOKEN=${info.authToken}`,
    info.daoId ? `DDN_HUB_DAO_ID=${info.daoId}` : '# DDN_HUB_DAO_ID=（store 中无 daoId，可手动补充）',
  ];
  writeFileSync(ENV_PATH, lines.join('\n') + '\n', { mode: 0o600 });
  try { chmodSync(ENV_PATH, 0o600); } catch { /* best-effort */ }
  console.log('✅ 已写入 .env（权限 600）');
  console.log(`   来源: ${info.storePath}`);
  console.log(`   baseUrl: ${info.baseUrl}`);
  console.log(`   authToken: ${mask(info.authToken)}（已掩码，未明文输出）`);
  console.log(`   daoId: ${info.daoId || '(空)'}（${info.daoName || ''}）`);
  console.log(`   登录账号: ${info.username || '(空)'}`);
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
