import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCredentialHelper, assessCredentialHelper } from '../src/lib/gitconfig.mjs';

test('解析基本的 credential.helper', () => {
  const text = ['[user]', '\tname = someone', '[credential]', '\thelper = manager'].join('\n');
  assert.equal(parseCredentialHelper(text), 'manager');
});

test('未配置时返回 null', () => {
  assert.equal(parseCredentialHelper('[user]\n\tname = someone'), null);
  assert.equal(parseCredentialHelper(''), null);
  assert.equal(parseCredentialHelper(null), null);
});

test('识别带子节的 credential 段', () => {
  const text = ['[credential "https://github.com"]', '\thelper = store'].join('\n');
  assert.equal(parseCredentialHelper(text), 'store');
});

test('忽略注释行', () => {
  const text = ['# 注释', '; 也是注释', '[credential]', '# helper = ignored', '\thelper = cache'].join('\n');
  assert.equal(parseCredentialHelper(text), 'cache');
});

test('只读取 credential 段，不受其他段干扰', () => {
  const text = ['[user]', '\thelper = 不该被读到', '[credential]', '\thelper = correct'].join('\n');
  assert.equal(parseCredentialHelper(text), 'correct');
});

test('空值的 helper 视为未配置', () => {
  assert.equal(parseCredentialHelper('[credential]\n\thelper = '), null);
});

test('兼容 CRLF', () => {
  assert.equal(parseCredentialHelper('[credential]\r\n\thelper = manager\r\n'), 'manager');
});

test('兼容等号两侧的空格', () => {
  assert.equal(parseCredentialHelper('[credential]\nhelper=manager'), 'manager');
});

test('已配置时判定为正常', () => {
  const r = assessCredentialHelper('manager');
  assert.equal(r.configured, true);
  assert.equal(r.level, 'ok');
});

test('未配置时判定为隐患并给出建议', () => {
  const r = assessCredentialHelper(null);
  assert.equal(r.configured, false);
  assert.equal(r.level, 'warn');
  assert.match(r.advice, /credential\.helper/);
});
