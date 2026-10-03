/**
 * hosts 文件解析与「屏蔽」检测。
 *
 * 为什么单独做这一项：hosts 文件把域名指向回环地址时，故障表现极具迷惑性。
 * DNS 查询会「成功」返回一个地址（127.0.0.1），客户端报的却是
 * connection refused —— 看起来像服务挂了或代理问题，实际是本地 hosts 干的。
 *
 * 真实案例：某机器的 hosts 里躺着 25 条 GitHub 条目，导致 git push、
 * SSH 部署密钥全部失效，而 GitHub API（走另一个未被屏蔽的域名）却正常。
 */

/** 视为「屏蔽」的目标地址。 */
const BLOCKING_IPS = new Set(['127.0.0.1', '0.0.0.0', '::1', 'localhost']);

/** 默认关注的域名：MCP 与日常开发高频使用的端点。 */
export const DEFAULT_WATCHED_DOMAINS = [
  'github.com',
  'api.github.com',
  'raw.githubusercontent.com',
  'api.githubcopilot.com',
];

/**
 * 解析 hosts 文本。
 *
 * 支持 `#` 行内注释、多余空白、CRLF 换行；忽略空行与格式不合法的行。
 *
 * @param {string} text hosts 文件内容
 * @returns {{ ip: string, hosts: string[], line: number }[]} 条目列表，line 为 1 起的行号
 */
export function parseHosts(text) {
  const entries = [];
  const lines = String(text ?? '').split(/\r?\n/);

  lines.forEach((raw, index) => {
    const withoutComment = raw.split('#')[0].trim();
    if (withoutComment === '') return;

    const parts = withoutComment.split(/\s+/);
    if (parts.length < 2) return;

    const [ip, ...names] = parts;
    entries.push({
      ip,
      hosts: names.map((n) => n.toLowerCase()),
      line: index + 1,
    });
  });

  return entries;
}

/**
 * 找出把关注域名指向回环地址的 hosts 条目。
 *
 * @param {ReturnType<typeof parseHosts>} entries parseHosts 的结果
 * @param {string[]} [domains] 关注的域名，默认 DEFAULT_WATCHED_DOMAINS
 * @returns {{ domain: string, ip: string, line: number }[]}
 */
export function findBlockedDomains(entries, domains = DEFAULT_WATCHED_DOMAINS) {
  const wanted = new Set(domains.map((d) => d.toLowerCase()));
  const blocked = [];

  for (const entry of entries) {
    if (!BLOCKING_IPS.has(entry.ip)) continue;
    for (const name of entry.hosts) {
      if (wanted.has(name)) {
        blocked.push({ domain: name, ip: entry.ip, line: entry.line });
      }
    }
  }

  return blocked;
}

/**
 * 判断解析结果是否异常。
 *
 * @param {string[]} addresses DNS 返回的地址列表
 * @returns {'ok' | 'loopback' | 'unresolved'}
 */
export function classifyAddresses(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) return 'unresolved';
  return addresses.every((a) => BLOCKING_IPS.has(a)) ? 'loopback' : 'ok';
}
