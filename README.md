# DreamFly · 公共 Mind Skill 平台

基于 Vue / UniApp 的 H5 前端、Fastify / TypeScript 后端和 PostgreSQL，支持邮箱验证码注册、服务端会话、意识 Skill 上传与发布、用户模型配置、MindCopy 流式交互和 GitHub 每周后台同步。

当前为本地可运行版本，服务器 Docker 部署暂缓。真实 SMTP、模型 API 和 GitHub Owner PAT 需要配置后联调；完整验证范围见 [实施记录](docs/IMPLEMENTATION_STATUS.md)。

## 开始使用

使用 Node.js 22 或 24 和 npm；项目统一维护 `package-lock.json`，不再维护 Yarn 锁文件。

```powershell
npm.cmd ci
npm.cmd ci --prefix server
npm.cmd run setup:local --prefix server
```

然后按 [本地运行说明](docs/LOCAL_DEVELOPMENT.md) 配置并启动 PostgreSQL，在项目根目录用一个终端启动应用：

```powershell
npm.cmd run dev
```

入口会自动停止上次登记的本项目开发服务，等待端口释放，检查数据库并执行迁移，再统一启动前端、API 和 worker。验证码使用真实 SMTP；本地模拟邮箱已移除。日志在 `data/dev-logs/`；Ctrl+C 停止本次启动的服务，PostgreSQL 保持独立运行。应用不是 Python 项目；`environment.yml` 仅提供可选开发工具环境。

## 文件布局

| 路径 | 用途 |
| --- | --- |
| `src/` | 前端源码；实际页面路由为 `src/pages.json` |
| `server/` | 后端 API、后台任务、数据库迁移和测试 |
| `packages/mind-format/` | 共享 Skill 格式规范、迁移与导出代码 |
| `docs/` | 当前使用说明、实现计划、实施记录与参考论文，采用单层结构 |
| `.github/` | GitHub 自动构建与检查 |
| `package.json`、`package-lock.json` | 前端依赖、运行脚本与 npm 锁文件 |
| `vite.config.js`、`index.html` | 前端构建配置与 H5 入口 |
| `.env.example` | 前端及基础设施环境变量模板 |
| `compose.yaml`、`compose.dev.yaml` | 基础设施及本地 Docker 覆盖配置，尚非完整应用部署 |
| `environment.yml` | 可选 Conda 工具环境 |

`node_modules/`、`dist/`、`.npm-cache/` 为本地产物；`data/`、`secrets/`、实际 `.env` 为本地数据或凭据。这些内容由 `.gitignore` 排除。用户文档、参考论文和环境变量示例可纳入 Git。

## 文档

- [本地运行与配置](docs/LOCAL_DEVELOPMENT.md)
- [统一 API](docs/API.md)
- [实施状态与验证记录](docs/IMPLEMENTATION_STATUS.md)
- [公共平台实现计划](docs/PUBLIC_PLATFORM_IMPLEMENTATION_PLAN.md)
- [意识上传：理论、技术与个体同一性探讨](docs/意识上传：理论、技术与个体同一性探讨.pdf)
- [DreamFly Mind Model](<docs/v1.DreamFly Mind Model.pdf>)
