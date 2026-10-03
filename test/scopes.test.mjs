import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseScopes,
  missingScopes,
  describeCapabilities,
  detectTokenType,
} from '../src/lib/scopes.mjs';

test('解析 scope 响应头', () => {
  assert.deepEqual(parseScopes('repo, workflow'), ['repo', 'workflow']);
});

test('解析时去空白、去重、排序', () => {
  assert.deepEqual(parseScopes(' workflow , repo ,repo,  '), ['repo', 'workflow']);
});

test('空响应头返回空数组', () => {
  assert.deepEqual(parseScopes(''), []);
  assert.deepEqual(parseScopes(null), []);
  assert.deepEqual(parseScopes(undefined), []);
});

test('细粒度令牌的 scope 响应头为空是正常现象', () => {
  // 细粒度令牌不通过 x-oauth-scopes 暴露权限，这里固定住这个事实
  assert.deepEqual(parseScopes(''), []);
});

test('计算缺失 scope', () => {
  assert.deepEqual(missingScopes(['repo'], ['repo', 'workflow']), ['workflow']);
  assert.deepEqual(missingScopes(['repo', 'workflow'], ['repo']), []);
  assert.deepEqual(missingScopes([], ['repo']), ['repo']);
});

test('缺失 scope 保持需求顺序', () => {
  assert.deepEqual(
    missingScopes([], ['admin:org', 'repo', 'workflow']),
    ['admin:org', 'repo', 'workflow'],
  );
});

test('能力清单：无任何 scope 也能读公共仓库', () => {
  const caps = describeCapabilities([]);
  const read = caps.find((c) => c.capability === '读取公共仓库');
  assert.equal(read.granted, true);
});

test('能力清单：无 scope 时不能读写代码', () => {
  const caps = describeCapabilities([]);
  const write = caps.find((c) => c.capability === '读写仓库代码');
  assert.equal(write.granted, false);
  assert.deepEqual(write.missing, ['repo']);
});

test('能力清单：有 repo 即可读写代码', () => {
  const caps = describeCapabilities(['repo']);
  const write = caps.find((c) => c.capability === '读写仓库代码');
  assert.equal(write.granted, true);
  assert.deepEqual(write.missing, []);
});

test('能力清单：操作 Actions 需要 repo 与 workflow', () => {
  const caps = describeCapabilities(['repo']);
  const actions = caps.find((c) => c.capability === '操作 GitHub Actions');
  assert.equal(actions.granted, false);
  assert.deepEqual(actions.missing, ['workflow']);
});

test('识别令牌类别：经典', () => {
  assert.equal(detectTokenType('ghp_abc123'), 'classic');
});

test('识别令牌类别：细粒度', () => {
  assert.equal(detectTokenType('github_pat_11ABC'), 'fine-grained');
});

test('识别令牌类别：未知', () => {
  assert.equal(detectTokenType('whatever'), 'unknown');
  assert.equal(detectTokenType(''), 'unknown');
});
