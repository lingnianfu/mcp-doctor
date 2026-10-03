import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHosts,
  findBlockedDomains,
  classifyAddresses,
} from '../src/lib/hosts.mjs';

test('解析基本的 hosts 条目', () => {
  const entries = parseHosts('127.0.0.1 localhost\n10.0.0.2 build.local');
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { ip: '127.0.0.1', hosts: ['localhost'], line: 1 });
  assert.deepEqual(entries[1], { ip: '10.0.0.2', hosts: ['build.local'], line: 2 });
});

test('一行可以映射多个域名', () => {
  const entries = parseHosts('127.0.0.1 github.com www.github.com');
  assert.deepEqual(entries[0].hosts, ['github.com', 'www.github.com']);
});

test('去掉行内注释', () => {
  const entries = parseHosts('127.0.0.1 evil.local # 这是注释');
  assert.deepEqual(entries[0].hosts, ['evil.local']);
});

test('忽略注释行、空行与格式不合法的行', () => {
  const text = ['# 注释', '', '   ', '127.0.0.1', '127.0.0.1 ok.local # x'].join('\n');
  const entries = parseHosts(text);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].hosts, ['ok.local']);
  assert.equal(entries[0].line, 5);
});

test('兼容 CRLF 换行', () => {
  const entries = parseHosts('127.0.0.1 a.local\r\n127.0.0.1 b.local\r\n');
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[1].hosts, ['b.local']);
});

test('域名统一转小写', () => {
  const entries = parseHosts('127.0.0.1 GitHub.COM');
  assert.deepEqual(entries[0].hosts, ['github.com']);
});

test('非字符串输入返回空数组', () => {
  assert.deepEqual(parseHosts(null), []);
  assert.deepEqual(parseHosts(undefined), []);
});

test('找出被屏蔽的关注域名', () => {
  const entries = parseHosts([
    '127.0.0.1 github.com',
    '127.0.0.1 api.github.com',
    '10.0.0.5 api.githubcopilot.com',
  ].join('\n'));

  const blocked = findBlockedDomains(entries, [
    'github.com',
    'api.github.com',
    'api.githubcopilot.com',
  ]);

  assert.deepEqual(blocked.map((b) => b.domain), ['github.com', 'api.github.com']);
  assert.equal(blocked[0].line, 1);
});

test('非回环地址不算屏蔽', () => {
  const entries = parseHosts('10.0.0.5 github.com');
  assert.deepEqual(findBlockedDomains(entries, ['github.com']), []);
});

test('0.0.0.0 与 ::1 同样视为屏蔽', () => {
  const entries = parseHosts('0.0.0.0 github.com\n::1 api.github.com');
  const blocked = findBlockedDomains(entries, ['github.com', 'api.github.com']);
  assert.equal(blocked.length, 2);
});

test('不关注未被列出的域名', () => {
  const entries = parseHosts('127.0.0.1 unrelated.local');
  assert.deepEqual(findBlockedDomains(entries, ['github.com']), []);
});

test('默认关注列表包含 GitHub 关键域名', () => {
  const entries = parseHosts('127.0.0.1 api.githubcopilot.com');
  assert.equal(findBlockedDomains(entries).length, 1);
});

test('判定解析结果：正常', () => {
  assert.equal(classifyAddresses(['140.82.114.21']), 'ok');
});

test('判定解析结果：全部回环', () => {
  assert.equal(classifyAddresses(['127.0.0.1']), 'loopback');
});

test('判定解析结果：解析失败', () => {
  assert.equal(classifyAddresses([]), 'unresolved');
  assert.equal(classifyAddresses(null), 'unresolved');
});

test('混合地址不算全回环', () => {
  assert.equal(classifyAddresses(['127.0.0.1', '140.82.114.21']), 'ok');
});
