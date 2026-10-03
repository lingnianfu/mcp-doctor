/**
 * 各项体检的执行体。
 *
 * 约定：每个检查函数都不抛异常，而是把「出错」本身作为一种检查结果返回。
 * 诊断工具在故障机器上崩溃，是它最不该有的行为 —— 而故障机器恰恰是
 * 它唯一会被运行的地方。
 */

import fs from 'node:fs/promises';
import dns from 'node:dns/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  parseHosts,
  findBlockedDomains,
  classifyAddresses,
  DEFAULT_WATCHED_DOMAINS,
} from './lib/hosts.mjs';
import { parseScopes, describeCapabilities, detectTokenType } from './lib/scopes.mjs';
import { extractConnectors } from './lib/connectors.mjs';
import { parseCredentialHelper, assessCredentialHelper } from './lib/gitconfig.mjs';
import { defaultHostsPath, defaultConnectorConfigPath } from './lib/platform.mjs';

export const DEFAULT_TIMEOUT_MS = 5000;

/** 默认探测的端点。 */
export const DEFAULT_TCP_TARGETS = [
  { host: 'github.com', port: 443 },
  { host: 'api.github.com', port: 443 },
  { host: 'api.githubcopilot.com', port: 443 },
];

/**
 * 给 Promise 加超时。
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 检查 hosts 文件是否屏蔽了关注域名。
 *
 * @param {string} [hostsPath]
 * @param {string[]} [domains]
 */
export async function checkHosts(hostsPath = defaultHostsPath(), domains = DEFAULT_WATCHED_DOMAINS) {
  try {
    const text = await fs.readFile(hostsPath, 'utf8');
    const entries = parseHosts(text);
    const blocked = findBlockedDomains(entries, domains);

    if (blocked.length === 0) {
      return {
        title: 'hosts 文件未屏蔽关注域名',
        level: 'ok',
        detail: `路径 ${hostsPath}，解析出 ${entries.length} 条记录，${domains.length} 个关注域名均未被指向回环地址`,
      };
    }

    return {
      title: `hosts 文件屏蔽了 ${blocked.length} 个关注域名`,
      level: 'fail',
      detail: blocked.map((b) => `${b.domain} → ${b.ip}（第 ${b.line} 行）`).join('\n'),
      advice: `编辑 ${hostsPath} 删除或注释上述行，然后刷新 DNS 缓存（Windows: ipconfig /flushdns）`,
    };
  } catch (error) {
    return {
      title: 'hosts 文件读取失败',
      level: 'warn',
      detail: `${hostsPath}\n${error.code ?? ''} ${error.message}`.trim(),
      advice: '确认路径是否存在、当前用户是否有读取权限',
    };
  }
}

/**
 * 检查关注域名的解析结果。
 *
 * 必须用 `dns.lookup` 而不是 `dns.resolve4`：前者走操作系统解析器，
 * **会读取 hosts 文件**，反映的是真实客户端看到的结果；后者直接查 DNS 服务器，
 * 完全绕过 hosts —— 用它做检查会把被 hosts 屏蔽的域名误判为「解析正常」。
 *
 * @param {string[]} [domains]
 * @param {number} [timeoutMs]
 */
export async function checkDns(domains = DEFAULT_WATCHED_DOMAINS, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const results = [];

  for (const domain of domains) {
    try {
      const records = await withTimeout(dns.lookup(domain, { all: true }), timeoutMs, `解析 ${domain}`);
      const addresses = records.map((r) => r.address);
      results.push({ domain, addresses: addresses.slice(0, 3), verdict: classifyAddresses(addresses) });
    } catch (error) {
      results.push({ domain, addresses: [], verdict: 'unresolved', error: error.code ?? error.message });
    }
  }

  const abnormal = results.filter((r) => r.verdict !== 'ok');
  if (abnormal.length === 0) {
    return {
      title: `DNS 解析正常（${results.length} 个域名）`,
      level: 'ok',
      detail: results.map((r) => `${r.domain} → ${r.addresses.join(', ')}`).join('\n'),
    };
  }

  return {
    title: `${abnormal.length} 个域名解析异常`,
    level: 'fail',
    detail: abnormal
      .map((r) =>
        r.verdict === 'loopback'
          ? `${r.domain} → ${r.addresses.join(', ')}（全部为回环地址，通常由 hosts 屏蔽造成）`
          : `${r.domain} → 解析失败（${r.error ?? '无返回'}）`,
      )
      .join('\n'),
    advice: '先查 hosts 文件；若 hosts 干净，再检查 DNS 服务器与网络策略',
  };
}

/**
 * 探测 TCP 端口连通性。
 *
 * @param {{ host: string, port: number }[]} [targets]
 * @param {number} [timeoutMs]
 */
export async function checkTcp(targets = DEFAULT_TCP_TARGETS, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const settle = async (target) => {
    const started = Date.now();
    const result = await new Promise((resolve) => {
      const socket = new net.Socket();
      const finish = (ok, reason) => {
        socket.destroy();
        resolve({ ok, reason });
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false, 'timeout'));
      socket.once('error', (err) => finish(false, err.code ?? err.message));
      socket.connect(target.port, target.host);
    });
    return { ...target, ...result, ms: Date.now() - started };
  };

  const results = await Promise.all(targets.map(settle));
  const failed = results.filter((r) => !r.ok);

  const detail = results
    .map((r) => `${r.host}:${r.port} → ${r.ok ? `可连接（${r.ms}ms）` : `失败（${r.reason}）`}`)
    .join('\n');

  if (failed.length === 0) {
    return { title: `TCP 连通性正常（${results.length} 个端点）`, level: 'ok', detail };
  }

  return {
    title: `${failed.length} 个端点无法连接`,
    level: 'fail',
    detail,
    advice: 'connection refused 多为 hosts 屏蔽；timeout 多为网络或代理问题；ETIMEDOUT 请检查防火墙',
  };
}

/**
 * 检查 git 的全局凭据配置。
 *
 * @param {string} [home]
 */
export async function checkGitCredential(home = os.homedir()) {
  const configPath = path.join(home, '.gitconfig');
  try {
    const text = await fs.readFile(configPath, 'utf8');
    const assessment = assessCredentialHelper(parseCredentialHelper(text));
    return {
      title: assessment.configured ? 'git 凭据助手已配置' : 'git 凭据助手未配置',
      level: assessment.level,
      detail: `${configPath}\n${assessment.detail}`,
      advice: assessment.advice === '无需操作' ? undefined : assessment.advice,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        title: '未找到全局 git 配置',
        level: 'warn',
        detail: `${configPath} 不存在`,
        advice: '若需要用 git 推送，先执行 `git config --global user.name` 与 `credential.helper` 设置',
      };
    }
    return {
      title: 'git 配置读取失败',
      level: 'info',
      detail: `${configPath}\n${error.message}`,
      advice: '该检查不影响其他项',
    };
  }
}

/**
 * 读取 DSH 连接器配置，汇总各连接状态。
 *
 * 只输出名称、传输方式、URL 与「是否配置凭据」的布尔值；
 * **不读取也不输出任何凭据内容**。
 *
 * @param {string} [configPath]
 */
export async function checkConnectors(configPath = defaultConnectorConfigPath()) {
  let text;
  try {
    text = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    return {
      title: 'DSH 连接器配置不可读',
      level: 'info',
      detail: `${configPath}\n${error.code === 'ENOENT' ? '文件不存在' : error.message}`,
      advice: '未使用 DSH 连接器时可忽略此项',
    };
  }

  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    return {
      title: 'DSH 连接器配置解析失败',
      level: 'warn',
      detail: `${configPath}\n${error.message}`,
      advice: '配置文件可能损坏；备份后可删除，让 DSH 重新生成',
    };
  }

  const connectors = extractConnectors(config);
  if (connectors.length === 0) {
    return {
      title: '连接器配置里没有可识别的连接条目',
      level: 'info',
      detail: `已读取 ${configPath}，但未解析出连接`,
      advice: '不同版本的 DSH 结构可能不同，此项仅供参考',
    };
  }

  const enabled = connectors.filter((c) => c.enabled);
  const withoutCredential = enabled.filter((c) => !c.hasCredential && c.authMode !== 'none');

  return {
    title: `发现 ${connectors.length} 个连接器（启用 ${enabled.length} 个）`,
    level: withoutCredential.length === 0 ? 'ok' : 'warn',
    detail: connectors
      .map((c) => `${c.enabled ? '启用' : '停用'} | ${c.name} | ${c.transport} | ${c.url} | 凭据:${c.hasCredential ? '已配置' : '无'}`)
      .join('\n'),
    advice:
      withoutCredential.length === 0
        ? undefined
        : `${withoutCredential.map((c) => c.name).join('、')} 声明了鉴权但未检出凭据，可能无法连接`,
  };
}

/**
 * 检查 GitHub 令牌的有效性与 scope 缺口。
 *
 * @param {string | undefined} token
 * @param {number} [timeoutMs]
 */
export async function checkGithubToken(token = process.env.GITHUB_TOKEN, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!token) {
    return {
      title: '未提供 GitHub 令牌',
      level: 'info',
      detail: '设置环境变量 GITHUB_TOKEN 后可启用此项检查',
      advice: 'export GITHUB_TOKEN=ghp_xxx（经典令牌）或 github_pat_xxx（细粒度令牌）',
    };
  }

  const type = detectTokenType(token);

  try {
    const response = await withTimeout(
      fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'mcp-doctor',
        },
      }),
      timeoutMs,
      '请求 api.github.com',
    );

    if (!response.ok) {
      return {
        title: `GitHub 令牌校验失败（HTTP ${response.status}）`,
        level: 'fail',
        detail: `令牌类别：${type}\nGitHub 返回 ${response.status} ${response.statusText}`,
        advice: '令牌可能已过期或被撤销，请重新生成',
      };
    }

    const user = await response.json();
    const scopes = parseScopes(response.headers.get('x-oauth-scopes'));

    if (type === 'classic') {
      const caps = describeCapabilities(scopes);
      const lacking = caps.filter((c) => !c.granted);
      return {
        title: `GitHub 令牌有效（经典令牌，${user.login}）`,
        level: lacking.length === 0 ? 'ok' : 'warn',
        detail: [
          `账号：${user.login}`,
          `scope：${scopes.length ? scopes.join(', ') : '（无）'}`,
          ...caps.map((c) => `${c.granted ? '✅' : '❌'} ${c.capability}${c.granted ? '' : `（缺 ${c.missing.join(', ')}）`}`),
        ].join('\n'),
        advice: lacking.length === 0 ? undefined : `缺少 scope：${[...new Set(lacking.flatMap((c) => c.missing))].join(', ')}`,
      };
    }

    return {
      title: `GitHub 令牌有效（细粒度令牌，${user.login}）`,
      level: 'info',
      detail: [
        `账号：${user.login}`,
        'scope 列表：细粒度令牌不通过响应头暴露权限',
        '判定方式：只能靠实际调用接口，从返回的 403 里反推缺失的权限项',
      ].join('\n'),
      advice: '若写操作返回 403，请检查该令牌的「仓库访问范围」是否覆盖目标仓库、以及对应权限项是否为「读写」',
    };
  } catch (error) {
    return {
      title: 'GitHub 令牌校验无法完成',
      level: 'warn',
      detail: `令牌类别：${type}\n${error.message}`,
      advice: '通常是网络不可达或 hosts 屏蔽 api.github.com，先看上面两项的结论',
    };
  }
}

/**
 * 跑完整套体检。
 *
 * @param {{ hostsPath?: string, connectorsPath?: string, domains?: string[], targets?: any[], includeNetwork?: boolean, token?: string }} [options]
 */
export async function runAllChecks(options = {}) {
  const {
    hostsPath = defaultHostsPath(),
    connectorsPath = defaultConnectorConfigPath(),
    domains = DEFAULT_WATCHED_DOMAINS,
    targets = DEFAULT_TCP_TARGETS,
    includeNetwork = true,
    token = process.env.GITHUB_TOKEN,
  } = options;

  const environment = [await checkHosts(hostsPath, domains), await checkGitCredential(), await checkConnectors(connectorsPath)];

  const network = includeNetwork
    ? [await checkDns(domains), await checkTcp(targets), await checkGithubToken(token)]
    : [{ title: '网络检查已跳过', level: 'info', detail: '使用了 --no-network' }];

  return [
    { title: '本机环境', checks: environment },
    { title: '网络连通性', checks: network },
  ];
}
