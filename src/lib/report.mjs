/**
 * 体检报告的渲染。
 *
 * 设计取向：报告是给人看的，所以每条结论都必须回答三个问题
 * ——「发生了什么」「算不算问题」「我该怎么办」。
 * 只报现象不给建议的诊断结果，等于没诊断。
 */

/** 四级状态，从好到坏。 */
export const LEVELS = ['ok', 'info', 'warn', 'fail'];

const ICONS = {
  ok: '✅',
  info: 'ℹ️ ',
  warn: '⚠️ ',
  fail: '❌',
};

/**
 * 状态对应的图标。
 * @param {string} level
 */
export function icon(level) {
  return ICONS[level] ?? '·';
}

/**
 * 汇总各状态的数量。
 * @param {{ level: string }[]} checks
 * @returns {{ ok: number, info: number, warn: number, fail: number, total: number }}
 */
export function summarize(checks) {
  const counts = { ok: 0, info: 0, warn: 0, fail: 0, total: 0 };
  for (const check of checks ?? []) {
    if (counts[check.level] === undefined) continue;
    counts[check.level] += 1;
    counts.total += 1;
  }
  return counts;
}

/**
 * 由汇总结果给出总体结论。
 *
 * @param {ReturnType<typeof summarize>} counts
 * @returns {{ level: string, verdict: string }}
 */
export function overallVerdict(counts) {
  if (counts.fail > 0) {
    return { level: 'fail', verdict: `发现 ${counts.fail} 个会直接导致失败的问题` };
  }
  if (counts.warn > 0) {
    return { level: 'warn', verdict: `没有致命问题，但有 ${counts.warn} 处隐患` };
  }
  return { level: 'ok', verdict: '未发现明显问题' };
}

/**
 * 渲染单个检查项。
 *
 * @param {{ id?: string, title: string, level: string, detail?: string, advice?: string }} check
 * @returns {string}
 */
export function formatCheck(check) {
  const lines = [`${icon(check.level)} ${check.title}`];
  if (check.detail) {
    for (const line of String(check.detail).split('\n')) {
      lines.push(`   ${line}`);
    }
  }
  if (check.advice) {
    lines.push(`   → 建议：${check.advice}`);
  }
  return lines.join('\n');
}

/**
 * 渲染完整报告。
 *
 * @param {string} title 报告标题
 * @param {{ title: string, checks: any[] }[]} sections 分组
 * @returns {string}
 */
export function renderReport(title, sections) {
  const all = (sections ?? []).flatMap((s) => s.checks ?? []);
  const counts = summarize(all);
  const verdict = overallVerdict(counts);

  const out = [title, '='.repeat(measure(title)), ''];

  for (const section of sections ?? []) {
    if (!section.checks?.length) continue;
    out.push(`## ${section.title}`, '');
    for (const check of section.checks) {
      out.push(formatCheck(check), '');
    }
  }

  out.push(
    '## 结论',
    '',
    `${icon(verdict.level)} ${verdict.verdict}`,
    `   通过 ${counts.ok} · 提示 ${counts.info} · 隐患 ${counts.warn} · 失败 ${counts.fail} · 合计 ${counts.total}`,
  );

  return out.join('\n');
}

/**
 * 计算显示宽度。
 *
 * 中文字符占两列，直接取 length 会让下划线对不齐。
 *
 * @param {string} text
 */
function measure(text) {
  let width = 0;
  for (const char of String(text ?? '')) {
    width += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char) ? 2 : 1;
  }
  return width;
}
