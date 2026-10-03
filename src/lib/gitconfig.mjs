/**
 * gitconfig 的最小解析：只取 credential.helper。
 *
 * 不引入完整 INI 解析器的理由：我们只关心一个键，而 gitconfig
 * 的完整语法（include、条件包含、多值）远远超出诊断需要。
 * 少解析、少出错。
 */

/**
 * 从 gitconfig 文本里读出 credential.helper。
 *
 * 支持 `[credential]` 与 `[credential "https://github.com"]` 两种写法，
 * 后者按子节处理但仍归入 credential。
 *
 * @param {string} text
 * @returns {string | null} 未配置时返回 null
 */
export function parseCredentialHelper(text) {
  let section = '';
  let helper = null;

  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;

    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      // `credential "https://github.com"` → 取首个词作为节名
      section = header[1].trim().split(/\s+/)[0].toLowerCase();
      continue;
    }

    if (section !== 'credential') continue;

    const pair = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (!pair) continue;
    if (pair[1].trim().toLowerCase() !== 'helper') continue;

    const value = pair[2].trim();
    if (value !== '') helper = value;
  }

  return helper;
}

/**
 * 给 credential.helper 的取值下判断。
 *
 * 空值意味着 git 没有任何凭据来源：push 到 HTTPS 远端时会直接失败
 * 或交互式索要密码 —— 在自动化场景里表现为「静默失败」。
 *
 * @param {string | null} helper
 * @returns {{ configured: boolean, level: string, detail: string, advice: string }}
 */
export function assessCredentialHelper(helper) {
  if (helper) {
    return {
      configured: true,
      level: 'ok',
      detail: `credential.helper = ${helper}`,
      advice: '无需操作',
    };
  }

  return {
    configured: false,
    level: 'warn',
    detail: '未配置 credential.helper，git 没有可用的凭据来源',
    advice:
      'HTTPS 远端 push 会失败。可执行 `git config --global credential.helper manager`，' +
      '或改用带令牌的地址、或在支持的环境里用 MCP 工具推送',
  };
}
