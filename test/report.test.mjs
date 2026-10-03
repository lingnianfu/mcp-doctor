import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  icon,
  summarize,
  overallVerdict,
  formatCheck,
  renderReport,
} from '../src/lib/report.mjs';

test('未知状态有回退图标', () => {
  assert.equal(icon('ok'), '✅');
  assert.equal(icon('fail'), '❌');
  assert.equal(icon('不存在的状态'), '·');
});

test('汇总各状态数量', () => {
  const counts = summarize([
    { level: 'ok' },
    { level: 'ok' },
    { level: 'warn' },
    { level: 'fail' },
    { level: 'info' },
  ]);
  assert.deepEqual(counts, { ok: 2, info: 1, warn: 1, fail: 1, total: 5 });
});

test('汇总忽略未知状态', () => {
  const counts = summarize([{ level: 'ok' }, { level: 'weird' }]);
  assert.equal(counts.total, 1);
});

test('汇总空输入不报错', () => {
  assert.deepEqual(summarize(null), { ok: 0, info: 0, warn: 0, fail: 0, total: 0 });
});

test('总体结论：有失败项时判为失败', () => {
  const verdict = overallVerdict(summarize([{ level: 'fail' }, { level: 'warn' }]));
  assert.equal(verdict.level, 'fail');
  assert.match(verdict.verdict, /1 个会直接导致失败/);
});

test('总体结论：只有隐患时判为警告', () => {
  const verdict = overallVerdict(summarize([{ level: 'warn' }, { level: 'ok' }]));
  assert.equal(verdict.level, 'warn');
  assert.match(verdict.verdict, /1 处隐患/);
});

test('总体结论：全通过时判为正常', () => {
  const verdict = overallVerdict(summarize([{ level: 'ok' }]));
  assert.equal(verdict.level, 'ok');
  assert.match(verdict.verdict, /未发现明显问题/);
});

test('渲染单项：包含图标、标题、详情与建议', () => {
  const text = formatCheck({
    title: 'hosts 文件',
    level: 'fail',
    detail: 'github.com → 127.0.0.1',
    advice: '删除对应行',
  });
  assert.match(text, /^❌ hosts 文件/);
  assert.match(text, /github\.com → 127\.0\.0\.1/);
  assert.match(text, /→ 建议：删除对应行/);
});

test('渲染单项：多行详情逐行缩进', () => {
  const text = formatCheck({ title: 'T', level: 'ok', detail: '第一行\n第二行' });
  assert.equal(text, '✅ T\n   第一行\n   第二行');
});

test('渲染单项：没有详情和建议时不产生空行', () => {
  assert.equal(formatCheck({ title: 'T', level: 'ok' }), '✅ T');
});

test('渲染完整报告：包含标题、分组与结论', () => {
  const text = renderReport('体检报告', [
    { title: '网络', checks: [{ title: 'DNS', level: 'ok', detail: '正常' }] },
    { title: '凭据', checks: [{ title: '令牌', level: 'warn', detail: '缺 scope' }] },
  ]);

  assert.match(text, /^体检报告\n=+\n/);
  assert.match(text, /## 网络/);
  assert.match(text, /## 凭据/);
  assert.match(text, /## 结论/);
  assert.match(text, /通过 1 · 提示 0 · 隐患 1 · 失败 0 · 合计 2/);
});

test('渲染完整报告：跳过空分组', () => {
  const text = renderReport('T', [
    { title: '空分组', checks: [] },
    { title: '有内容', checks: [{ title: 'X', level: 'ok' }] },
  ]);
  assert.doesNotMatch(text, /空分组/);
  assert.match(text, /有内容/);
});

test('渲染完整报告：标题下划线按中文宽度对齐', () => {
  const text = renderReport('中文标题', []);
  const [, underline] = text.split('\n');
  // 「中文标题」四个汉字 = 8 列
  assert.equal(underline.length, 8);
});
