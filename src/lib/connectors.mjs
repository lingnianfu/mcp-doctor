/**
 * 连接器配置的提取（纯函数）。
 *
 * 设计约束有两条，都是踩过坑之后定下的：
 *
 *  1. **永不输出凭据**。这里只挑选白名单字段（名称、传输方式、URL、
 *     是否启用），凭据字段一律不进入返回值。诊断工具把密钥打进日志，
 *     是比原本要排查的故障更严重的事。
 *
 *  2. **容忍畸形配置**。真实的 DSH 配置里出现过重复键，导致
 *     某些解析器直接报错。所以这里对每一层都做类型判断，
 *     宁可少提取几个字段，也不要抛异常。
 */

/** 可能承载凭据的字段名。 */
const CREDENTIAL_FIELDS = ['bearerToken', 'apiKeyValue', 'token', 'secret'];

/**
 * 判断一条连接是否配置了凭据。
 *
 * @param {any} conn
 * @returns {boolean}
 */
export function hasCredential(conn) {
  if (!conn || typeof conn !== 'object') return false;

  for (const field of CREDENTIAL_FIELDS) {
    if (isNonEmptyString(conn[field])) return true;
  }

  // DSH 把凭据放在 auth 子对象里：{ mode: 'bearer', bearerToken: '...' }
  const auth = conn.auth;
  if (auth && typeof auth === 'object') {
    for (const field of [...CREDENTIAL_FIELDS, 'apiKey', 'value']) {
      if (isNonEmptyString(auth[field])) return true;
    }
  }

  const headers = conn.headers;
  if (headers && typeof headers === 'object') {
    for (const key of ['Authorization', 'authorization', 'bearerToken', 'x-api-key']) {
      if (isNonEmptyString(headers[key])) return true;
    }
  }

  const env = conn.env;
  if (env && typeof env === 'object' && Object.keys(env).length > 0) return true;

  return false;
}

/** 非空字符串判断。 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

/**
 * 从配置对象里收集连接条目。
 *
 * 真实结构是 `tables.connections`（对象映射），但历史版本与简化配置里
 * 也出现过顶层 `connections`（数组）。两处都试，第一个非空的生效。
 *
 * @param {any} config
 * @returns {any[]}
 */
export function collectConnectionObjects(config) {
  if (!config || typeof config !== 'object') return [];

  for (const container of [config?.tables?.connections, config?.connections]) {
    const items = toObjectList(container);
    if (items.length > 0) return items;
  }

  return [];
}

/**
 * 把「数组」或「对象映射」统一成对象数组。
 *
 * @param {any} container
 * @returns {any[]}
 */
function toObjectList(container) {
  const isObject = (item) => Boolean(item) && typeof item === 'object';
  if (Array.isArray(container)) return container.filter(isObject);
  if (container && typeof container === 'object') return Object.values(container).filter(isObject);
  return [];
}

/**
 * 把一条连接压缩成诊断所需的摘要。
 *
 * @param {any} conn
 * @returns {{ key: string, name: string, serverName: string, transport: string, url: string, enabled: boolean, authMode: string, hasCredential: boolean }}
 */
export function summarizeConnector(conn) {
  const serverName = typeof conn?.serverName === 'string' ? conn.serverName : '';
  const name = typeof conn?.name === 'string' && conn.name !== '' ? conn.name : serverName || conn?.key || '(未命名)';
  const hasCommand = typeof conn?.command === 'string' && conn.command !== '';
  const hasUrl = typeof conn?.url === 'string' && conn.url !== '';

  const transport =
    typeof conn?.transport === 'string' && conn.transport !== ''
      ? conn.transport
      : hasCommand
        ? 'stdio'
        : hasUrl
          ? 'streamable-http'
          : 'unknown';

  const credentials = hasCredential(conn);

  // 鉴权方式优先取显式声明：先看顶层 authMode，再看 auth.mode（DSH 实际结构）
  const declaredMode = [conn?.authMode, conn?.auth?.mode].find(isNonEmptyString) ?? '';

  return {
    key: typeof conn?.key === 'string' ? conn.key : '',
    name,
    serverName,
    transport,
    url: hasUrl ? conn.url : hasCommand ? conn.command : '',
    enabled: conn?.enabled !== false,
    authMode: declaredMode || (credentials ? 'bearer' : 'none'),
    hasCredential: credentials,
  };
}

/**
 * 提取全部连接的摘要。
 *
 * @param {any} config
 * @returns {ReturnType<typeof summarizeConnector>[]}
 */
export function extractConnectors(config) {
  return collectConnectionObjects(config).map(summarizeConnector);
}
