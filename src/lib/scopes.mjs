/**
 * GitHub 令牌能力的解析与缺口分析。
 *
 * 这里的核心事实是：**不同类别的令牌，判定权限的方式完全不同**。
 *
 *  - 经典令牌（ghp_）：权限以 scope 列表形式出现在响应头的 x-oauth-scopes 里，
 *    可以直接读出来，缺什么一目了然。
 *  - 细粒度令牌（github_pat_）：响应头里的 x-oauth-scopes 是空的，
 *    权限是「按仓库 + 按权限项」授予的，只能靠实际调用接口从错误里推断。
 *
 * 本模块只做纯计算：把「已有 scope」和「需要 scope」比对出缺口。
 * 网络与响应头读取交给调用方。
 */

/** 从 0 开始的 scope 集合，代表公开只读能力。 */
export const PUBLIC_READ_SCOPES = [];

/** 能力 → 所需 scope。空数组表示无需授权（公共资源只读）。 */
export const CAPABILITY_SCOPES = {
  '读取公共仓库': PUBLIC_READ_SCOPES,
  '读写仓库代码': ['repo'],
  '操作 GitHub Actions': ['repo', 'workflow'],
  '管理组织事务': ['admin:org'],
};

/**
 * 解析 x-oauth-scopes 响应头。
 *
 * @param {string | null | undefined} headerValue 形如 `repo, workflow`
 * @returns {string[]} 去空、去重、排序后的 scope 列表
 */
export function parseScopes(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return [];
  const unique = new Set(
    headerValue
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return [...unique].sort();
}

/**
 * 计算缺失的 scope。
 *
 * @param {string[]} have 已授予
 * @param {string[]} need 需要
 * @returns {string[]} 缺失部分（保持 need 的顺序）
 */
export function missingScopes(have, need) {
  const granted = new Set(have ?? []);
  return (need ?? []).filter((s) => !granted.has(s));
}

/**
 * 把 scope 列表翻译成「能做什么」的能力清单。
 *
 * @param {string[]} scopes
 * @returns {{ capability: string, need: string[], granted: boolean, missing: string[] }[]}
 */
export function describeCapabilities(scopes) {
  const have = scopes ?? [];
  return Object.entries(CAPABILITY_SCOPES).map(([capability, need]) => {
    const missing = missingScopes(have, need);
    return { capability, need, granted: missing.length === 0, missing };
  });
}

/**
 * 判断令牌类别。
 *
 * @param {string} token
 * @returns {'classic' | 'fine-grained' | 'unknown'}
 */
export function detectTokenType(token) {
  const value = String(token ?? '');
  if (value.startsWith('ghp_')) return 'classic';
  if (value.startsWith('github_pat_')) return 'fine-grained';
  return 'unknown';
}
