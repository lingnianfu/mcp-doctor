/**
 * checks.mjs 的集成测试。
 *
 * 为什么单独补这一层：lib/ 下的纯函数已经有单元测试，但真正决定
 * 「体检工具在故障机器上会不会崩」的是 I/O 层 —— 文件不存在、
 * JSON 损坏、权限不足。这些分支在真实环境里一定会被触发，
 * 而它们此前完全没有测试覆盖。
 *
 * 全部用例都使用临时目录作为夹具，不依赖真实环境、不访问网络。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  checkHosts,
  checkConnectors,
  checkGitCredential,
  checkGithubToken,
} from '../src/checks.mjs';

/**
 * 在临时目录里执行，结束后自动清理。
 * @param {(dir: string) => Promise<any>} fn
 */
async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-doctor-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** 指向一个保证不存在的路径。 */
function missingPath(name) {
  return path.join(os.tmpdir(), `mcp-doctor-missing-${name}-${process.pid}`);
}

// ——— checkHosts ———

test('checkHosts：干净的 hosts 判为通过', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'hosts');
    await fs.writeFile(file, '127.0.0.1 localhost\n10.0.0.1 build.local\n');

    const result = await checkHosts(file, ['github.com']);
    assert.equal(result.level, 'ok');
  });
});

test('checkHosts：发现屏蔽时判为失败，并指出行号', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'hosts');
    await fs.writeFile(file, '# 注释行\n127.0.0.1 github.com\n');

    const result = await checkHosts(file, ['github.com']);
    assert.equal(result.level, 'fail');
    assert.match(result.detail, /github\.com → 127\.0\.0\.1（第 2 行）/);
    assert.ok(result.advice, '失败项必须给出修复建议');
  });
});

test('checkHosts：文件不存在时降级为隐患，而不是抛异常', async () => {
  const result = await checkHosts(missingPath('hosts'), ['github.com']);
  assert.equal(result.level, 'warn');
  assert.ok(result.title.includes('读取失败'));
});

// ——— checkConnectors ———

test('checkConnectors：解析真实落盘结构', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'mcp_connector.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        unit: { name: 'mcp_connector' },
        tables: {
          connections: {
            'github-github': {
              key: 'github-github',
              name: 'GitHub',
              transport: 'streamable-http',
              url: 'https://api.githubcopilot.com/mcp/',
              auth: { mode: 'bearer', bearerToken: 'ghp_fixture' },
            },
          },
        },
      }),
    );

    const result = await checkConnectors(file);
    assert.equal(result.level, 'ok');
    assert.match(result.detail, /GitHub/);
    assert.match(result.detail, /凭据:已配置/);
  });
});

test('checkConnectors：声明鉴权却无凭据时判为隐患', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'mcp_connector.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        tables: {
          connections: {
            k: { key: 'k', name: 'Broken', authMode: 'bearer', url: 'https://x/' },
          },
        },
      }),
    );

    const result = await checkConnectors(file);
    assert.equal(result.level, 'warn');
    assert.match(result.advice, /Broken/);
  });
});

test('checkConnectors：JSON 损坏时判为隐患且不抛异常', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'mcp_connector.json');
    await fs.writeFile(file, '{ 这不是合法的 JSON');

    const result = await checkConnectors(file);
    assert.equal(result.level, 'warn');
    assert.ok(result.title.includes('解析失败'));
  });
});

test('checkConnectors：配置缺失时判为提示', async () => {
  const result = await checkConnectors(missingPath('connectors'));
  assert.equal(result.level, 'info');
});

test('checkConnectors：端到端不泄漏凭据原文', async () => {
  await withTempDir(async (dir) => {
    const secret = 'ghp_ENDOFTENDTOTESTSECRETVALUE';
    const file = path.join(dir, 'mcp_connector.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        tables: {
          connections: {
            k: { key: 'k', name: 'X', url: 'https://x/', auth: { mode: 'bearer', bearerToken: secret } },
          },
        },
      }),
    );

    const result = await checkConnectors(file);
    assert.ok(!JSON.stringify(result).includes(secret), '体检报告里不应出现凭据原文');
  });
});

// ——— checkGitCredential ———

test('checkGitCredential：已配置 helper 判为通过', async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, '.gitconfig'), '[credential]\n\thelper = manager\n');

    const result = await checkGitCredential(dir);
    assert.equal(result.level, 'ok');
    assert.equal(result.advice, undefined, '通过项不该给出建议');
  });
});

test('checkGitCredential：未配置 helper 判为隐患', async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, '.gitconfig'), '[user]\n\tname = someone\n');

    const result = await checkGitCredential(dir);
    assert.equal(result.level, 'warn');
    assert.match(result.advice, /credential\.helper/);
  });
});

test('checkGitCredential：没有全局配置时判为隐患', async () => {
  await withTempDir(async (dir) => {
    const result = await checkGitCredential(dir);
    assert.equal(result.level, 'warn');
  });
});

// ——— checkGithubToken（离线分支） ———

test('checkGithubToken：未提供令牌时判为提示，且不发起网络请求', async () => {
  const result = await checkGithubToken(null);
  assert.equal(result.level, 'info');
  assert.match(result.detail, /GITHUB_TOKEN/);
});
