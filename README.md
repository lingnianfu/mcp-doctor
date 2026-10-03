# mcp-doctor

MCP 环境体检工具。零依赖，一条命令把「为什么 MCP 连不上」查清楚。

## 它解决什么问题

接入 MCP 服务时的故障往往指向一个模糊的表象：**连不上**。但「连不上」至少有
六种完全不同的成因，处理方式也完全不同 —— 而它们报出来的错都很像。

这个工具把这六类原因逐项分开检查，并给出具体的修复动作：

| 检查项 | 抓什么 | 典型表现 |
|---|---|---|
| hosts 屏蔽 | 域名被指向回环地址 | `connection refused`，看起来像服务挂了 |
| DNS 解析 | 解析失败或全部指向回环 | 域名「能解析」但连不上 |
| TCP 连通性 | 关键端点端口是否可达 | timeout / refused / 被防火墙拦 |
| GitHub 令牌 | 令牌是否有效、scope 是否够用 | 读能通、写全是 403 |
| git 凭据 | 是否配置了 credential.helper | push 静默失败或反复索要密码 |
| 连接器配置 | DSH 连接器配置是否可解析 | 配置损坏导致连接器不加载 |

## 用法

```bash
# 完整体检
node src/cli.mjs

# 只查本机，跳过所有网络请求
node src/cli.mjs --no-network

# JSON 输出，便于接进其他工具或 CI
node src/cli.mjs --json

# 指定配置文件位置
node src/cli.mjs --hosts /etc/hosts --connectors ~/.dsh/storages/mcp_connector.json
```

启用令牌检查需要先提供令牌：

```bash
# Windows PowerShell
$env:GITHUB_TOKEN = "ghp_xxxx"

# Linux / macOS
export GITHUB_TOKEN=ghp_xxxx
```

**退出码**：`0` 无致命问题 · `1` 存在致命问题 · `2` 参数错误。
可以直接用作 CI 卡点。

## 输出示例

```
MCP 环境体检报告
================

## 本机环境

❌ hosts 文件屏蔽了 3 个关注域名
   api.github.com → 127.0.0.1（第 141 行）
   raw.githubusercontent.com → 127.0.0.1（第 150 行）
   github.com → 127.0.0.1（第 161 行）
   → 建议：编辑 C:\Windows\System32\drivers\etc\hosts 删除或注释上述行，
           然后刷新 DNS 缓存（Windows: ipconfig /flushdns）

⚠️  git 凭据助手未配置
   未配置 credential.helper，git 没有可用的凭据来源
   → 建议：HTTPS 远端 push 会失败

## 网络连通性

❌ 2 个端点无法连接
   github.com:443 → 失败（ECONNREFUSED）
   api.githubcopilot.com:443 → 可连接（283ms）

## 结论

❌ 发现 3 个会直接导致失败的问题
   通过 1 · 提示 1 · 隐患 1 · 失败 3 · 合计 6
```

## 设计取舍

**每个检查都不抛异常。** 出错本身作为一种检查结果返回。诊断工具在故障机器上
崩溃，是它最不该有的行为 —— 而故障机器恰恰是它唯一会被运行的地方。

**永不输出凭据。** 连接器检查只读取名称、传输方式、URL 和「是否配置了凭据」
的布尔值，凭据字段一律不进入返回值。诊断工具把密钥打进日志，比它要排查的
故障更严重。这条有专门的测试守着。

**用操作系统解析器查 DNS，而不是直接查 DNS 服务器。** 只有前者会读取 hosts
文件，反映真实客户端看到的结果。

**主机相关的假设集中在一处。** 路径规则都在 `src/lib/platform.mjs`，
方便移植和测试。

## 项目结构

```
src/
├── cli.mjs              命令行入口：参数解析、报告输出、退出码
├── checks.mjs           各检查项的 I/O 实现
└── lib/
    ├── hosts.mjs        hosts 解析与屏蔽判定（纯函数）
    ├── scopes.mjs       GitHub 令牌能力分析（纯函数）
    ├── connectors.mjs   连接器配置提取、凭据脱敏（纯函数）
    ├── gitconfig.mjs    gitconfig 最小解析（纯函数）
    ├── report.mjs       报告渲染（纯函数）
    └── platform.mjs     平台相关默认路径
```

I/O 与纯逻辑分离：所有判断逻辑都在 `lib/` 下以纯函数实现，因此可以
脱离真实环境完整测试。

## 测试

```bash
npm test
```

覆盖 hosts 解析边界、scope 缺口分析、能力推断、连接器的真实落盘结构
（含 `tables.connections` 与 `auth` 子对象）、凭据脱敏、报告渲染与中文宽度对齐。

## 环境要求

Node.js >= 20（使用内置 `node:test` 与全局 `fetch`，无第三方依赖）。
