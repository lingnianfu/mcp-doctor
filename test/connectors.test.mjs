import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasCredential,
  collectConnectionObjects,
  summarizeConnector,
  extractConnectors,
} from '../src/lib/connectors.mjs';

test('识别直接字段形式的凭据', () => {
  assert.equal(hasCredential({ bearerToken: 'x' }), true);
});

test('识别 headers 里的凭据', () => {
  assert.equal(hasCredential({ headers: { Authorization: 'Bearer x' } }), true);
  assert.equal(hasCredential({ headers: { 'x-api-key': 'k' } }), true);
});

test('识别 stdio 连接的环境变量凭据', () => {
  assert.equal(hasCredential({ env: { API_KEY: 'k' } }), true);
});

test('没有凭据时返回 false', () => {
  assert.equal(hasCredential({}), false);
  assert.equal(hasCredential({ headers: {} }), false);
  assert.equal(hasCredential(null), false);
});

test('空字符串凭据不算配置', () => {
  assert.equal(hasCredential({ bearerToken: '' }), false);
});

test('collectConnectionObjects 支持数组形式', () => {
  const items = collectConnectionObjects({ connections: [{ a: 1 }, { b: 2 }] });
  assert.equal(items.length, 2);
});

test('collectConnectionObjects 支持对象映射形式', () => {
  const items = collectConnectionObjects({ connections: { one: { a: 1 }, two: { b: 2 } } });
  assert.equal(items.length, 2);
});

test('collectConnectionObjects 对畸形输入返回空数组', () => {
  assert.deepEqual(collectConnectionObjects(null), []);
  assert.deepEqual(collectConnectionObjects({}), []);
  assert.deepEqual(collectConnectionObjects({ connections: 'oops' }), []);
});

test('summary 从 url 推断 http 传输', () => {
  const s = summarizeConnector({ name: 'A', url: 'https://x/mcp' });
  assert.equal(s.transport, 'streamable-http');
  assert.equal(s.url, 'https://x/mcp');
});

test('summary 从 command 推断 stdio 传输', () => {
  const s = summarizeConnector({ name: 'B', command: 'npx' });
  assert.equal(s.transport, 'stdio');
  assert.equal(s.url, 'npx');
});

test('summary 缺少名称时使用 serverName 兜底', () => {
  const s = summarizeConnector({ serverName: 'github', url: 'https://x' });
  assert.equal(s.name, 'github');
});

test('summary 完全缺少标识时给出占位名', () => {
  assert.equal(summarizeConnector({}).name, '(未命名)');
});

test('summary 默认视为启用', () => {
  assert.equal(summarizeConnector({ name: 'A' }).enabled, true);
  assert.equal(summarizeConnector({ name: 'A', enabled: false }).enabled, false);
});

test('summary 按凭据推断 authMode', () => {
  assert.equal(summarizeConnector({ name: 'A', bearerToken: 'x' }).authMode, 'bearer');
  assert.equal(summarizeConnector({ name: 'A' }).authMode, 'none');
});

test('summary 尊重显式声明的 authMode', () => {
  assert.equal(summarizeConnector({ name: 'A', authMode: 'none', bearerToken: 'x' }).authMode, 'none');
});

test('extractConnectors 汇总多条连接', () => {
  const list = extractConnectors({
    connections: [
      { key: 'k1', name: 'GitHub', url: 'https://api.githubcopilot.com/mcp/', authMode: 'bearer', headers: { Authorization: 'Bearer secret' } },
      { key: 'k2', name: 'Stock', command: 'npx', enabled: false },
    ],
  });
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'GitHub');
  assert.equal(list[0].hasCredential, true);
  assert.equal(list[1].enabled, false);
});

test('输出里绝不包含凭据原文', () => {
  const secret = 'ghp_SUPERSECRETVALUE123';
  const list = extractConnectors({
    connections: [
      { name: 'GitHub', url: 'https://x', headers: { Authorization: `Bearer ${secret}` }, bearerToken: secret },
    ],
  });

  const serialized = JSON.stringify(list);
  assert.ok(!serialized.includes(secret), '摘要输出里不应出现凭据原文');
  assert.ok(!serialized.includes('SUPERSECRET'), '摘要输出里不应出现凭据片段');
  assert.equal(list[0].hasCredential, true);
});

test('extractConnectors 对畸形输入返回空数组', () => {
  assert.deepEqual(extractConnectors(null), []);
  assert.deepEqual(extractConnectors({ connections: 42 }), []);
});

// ——— 以下为针对 DSH 真实落盘结构的回归测试 ———
// 真实结构是 config.tables.connections（对象映射），凭据在 auth 子对象里。

test('识别 DSH 真实结构：tables.connections 对象映射', () => {
  const list = extractConnectors({
    unit: { name: 'mcp_connector', version: 1 },
    tables: {
      connections: {
        'github-github': { key: 'github-github', name: 'GitHub', serverName: 'github', transport: 'streamable-http', url: 'https://api.githubcopilot.com/mcp/' },
        'wind-stock-data-stock-data': { key: 'wind-stock-data-stock-data', name: 'Wind·股票数据', serverName: 'wind_stock_data', transport: 'streamable-http', url: 'https://mcp.wind.com.cn/x/' },
      },
    },
  });

  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'GitHub');
  assert.equal(list[1].serverName, 'wind_stock_data');
});

test('识别 auth 子对象里的凭据', () => {
  assert.equal(hasCredential({ auth: { mode: 'bearer', bearerToken: 'x' } }), true);
  assert.equal(hasCredential({ auth: { mode: 'none' } }), false);
  assert.equal(hasCredential({ auth: { mode: 'bearer', bearerToken: '' } }), false);
});

test('从 auth.mode 读取鉴权方式', () => {
  assert.equal(summarizeConnector({ name: 'A', auth: { mode: 'bearer' } }).authMode, 'bearer');
  assert.equal(summarizeConnector({ name: 'A', auth: { mode: 'none' } }).authMode, 'none');
});

test('顶层 authMode 优先于 auth.mode', () => {
  assert.equal(summarizeConnector({ name: 'A', authMode: 'api-key', auth: { mode: 'bearer' } }).authMode, 'api-key');
});

test('真实结构下的凭据不泄漏', () => {
  const secret = 'github_pat_11ABCDEFGSECRETVALUE';
  const list = extractConnectors({
    tables: {
      connections: {
        'github-github': {
          key: 'github-github',
          name: 'GitHub',
          url: 'https://api.githubcopilot.com/mcp/',
          headers: { Accept: 'application/json' },
          auth: { mode: 'bearer', bearerToken: secret },
        },
      },
    },
  });

  assert.equal(list[0].hasCredential, true);
  assert.equal(list[0].authMode, 'bearer');
  assert.ok(!JSON.stringify(list).includes(secret));
});

test('tables.connections 为空时回退到顶层 connections', () => {
  const list = extractConnectors({ tables: { connections: {} }, connections: [{ name: 'Fallback', url: 'https://x' }] });
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Fallback');
});
