#!/usr/bin/env node
/**
 * mcp-doctor —— MCP 环境体检工具
 *
 * 用法：
 *   node src/cli.mjs                 # 完整体检
 *   node src/cli.mjs --no-network    # 只查本机（跳过 DNS/TCP/令牌）
 *   node src/cli.mjs --json          # 输出 JSON，便于接进其他工具
 *
 * 退出码：0 = 无致命问题；1 = 存在致命问题（可用于 CI 卡点）。
 */

import { runAllChecks } from './checks.mjs';
import { renderReport, summarize } from './lib/report.mjs';
import { defaultHostsPath, defaultConnectorConfigPath } from './lib/platform.mjs';

const HELP = `mcp-doctor —— MCP 环境体检工具

自动诊断 MCP 接入过程中最常见的几类故障：
  · hosts 文件把域名指向回环地址（导致 connection refused）
  · DNS 解析异常或不可达
  · 关键端点 TCP 不通
  · GitHub 令牌缺失或 scope 不足
  · git 未配置凭据助手
  · DSH 连接器配置是否可解析

用法
  mcp-doctor [选项]

选项
  --hosts <路径>        hosts 文件位置（默认 ${defaultHostsPath()}）
  --connectors <路径>   DSH 连接器配置位置（默认 ${defaultConnectorConfigPath()}）
  --no-network          跳过所有网络检查
  --json                以 JSON 输出
  --help, -h            显示本帮助

环境变量
  GITHUB_TOKEN          提供后启用令牌权限检查
`;

/**
 * 解析命令行参数。
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const options = { includeNetwork: true, json: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--no-network':
        options.includeNetwork = false;
        break;
      case '--json':
        options.json = true;
        break;
      case '--hosts':
        options.hostsPath = argv[++i];
        break;
      case '--connectors':
        options.connectorsPath = argv[++i];
        break;
      default:
        if (arg.startsWith('--')) {
          options.unknown = [...(options.unknown ?? []), arg];
        }
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (options.unknown?.length) {
    process.stderr.write(`无法识别的选项：${options.unknown.join(', ')}\n\n${HELP}`);
    return 2;
  }

  const sections = await runAllChecks(options);
  const all = sections.flatMap((s) => s.checks);
  const counts = summarize(all);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), counts, sections }, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReport('MCP 环境体检报告', sections)}\n`);
  }

  return counts.fail > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`体检过程异常终止：${error?.stack ?? error}\n`);
    process.exitCode = 2;
  });
