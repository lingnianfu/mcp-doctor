/**
 * 平台相关的默认路径。
 *
 * 单独抽出来是为了让主机相关的假设集中在一处 —— 体检工具本身
 * 要能在多平台上跑，硬编码 Windows 路径会让测试和移植都变难。
 */

import os from 'node:os';
import path from 'node:path';

/**
 * hosts 文件的默认位置。
 * @param {string} [platform] 默认取当前平台
 */
export function defaultHostsPath(platform = process.platform) {
  if (platform === 'win32') {
    return 'C:\\Windows\\System32\\drivers\\etc\\hosts';
  }
  return '/etc/hosts';
}

/**
 * DSH 连接器配置的默认位置。
 *
 * 这是 DSH 的内部存储路径；本工具只读它，且只读取拼接后的公开字段
 * （名称、传输方式、URL），**不读取也不输出任何凭据**。
 *
 * @param {string} [home] 默认取当前用户主目录
 */
export function defaultConnectorConfigPath(home = os.homedir()) {
  return path.join(home, '.dsh', 'storages', 'mcp_connector.json');
}
