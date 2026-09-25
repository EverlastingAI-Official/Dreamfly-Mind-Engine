# 实施状态与验证记录

日期：2026-09-25。按用户要求实现本地平台，**未执行远程服务器 Docker 部署**。本记录描述已存在的代码与实际验证范围，不能替代外部账号联调。

## 已实现

| 计划领域 | 实现位置 | 当前状态 |
| --- | --- | --- |
| 工程修复 | index.html、src/pages.json、package.json、样例文件 | H5 入口补齐；移除缺页路由；11 个样例可迁移；已清理文档中的疑似凭据 |
| 身份确认 | server/src/auth.ts、crypto.ts、001_platform.sql | 邮箱验证码注册、邮箱密码登录、密码重置、服务端 Session、CSRF、限流 |
| PostgreSQL | server/src/db.ts、migrate.ts、server/migrations | 事务迁移、资源归属、版本、消息、任务和凭据持久化 |
| 格式规范 | packages/mind-format、server/src/format.ts | Schema、旧字段迁移、SKILL.md/JSON/ZIP、冲突及资源路径校验 |
| 公共平台 | src/pages/platform/index.vue、server/src/skills.ts | 公开目录、个人草稿、版本、发布选择、导入导出、素材管理、管理下架 |
| 用户模型 | server/src/providers.ts | 多档案、三协议、连接测试、模型列表、加密密钥、自定义公开 HTTPS 入口 |
| MindCopy | server/src/conversations.ts | 角色版本和用户隔离、公开记忆过滤、输入预算、流式消息、取消、历史与去重 |
| GitHub | server/src/github.ts、github-schedule.ts、worker.ts、003_weekly_github.sql | 每周最新版本同步、持久化批次、停机补执行、任务筛选与分页、Owner PAT 直接提交、上传与 GitHub 解耦 |
| 开发工具 | server/scripts、docs/LOCAL_DEVELOPMENT.md | 本地配置初始化、开发邮箱、管理员设置、过期记录维护、运行说明 |
| API/CI | server/src/openapi.ts、docs/API.md、原 CI 工作流 | OpenAPI 目录与核心请求结构；实际前后端构建和针对性验证命令 |

## 实际执行的验证

### 每周同步调整（2026-09-25）

- 上传保存和发布不再检查 GitHub 配置或立即入队；平台查询、筛选和下载继续读取服务端数据。
- 默认每周一 03:00 Asia/Shanghai，时间和时区可配置。数据库持久化批次、下次时间，多 worker 去重，停机恢复补做一次最新内容同步。
- 失败任务跨周复用 ID 和内容，保持远端去重能力；单项退避不阻止其他任务，撤销公开的任务标记跳过。
- 增加批次统计、任务状态/日期/Skill/批次筛选及分页，管理员可查看全部批次、任务并重试失败项。
- 服务端 TypeScript 检查、H5 构建通过；`tests/platform.test.ts` 和 `tests/format-and-stream.test.ts` 共 32 项通过，覆盖周边界、并发调度、停机补执行、截止后更新、失败恢复、无配置发布下载及旧即时任务迁移。
- 本地已应用 `003_weekly_github.sql`。迁移前确认 GitHub 同步关闭且业务库无 GitHub 任务；数据库默认下次计划为 2026-09-28 03:00（Asia/Shanghai）。现有服务需重启加载新版代码。
- 本轮前端构建曾因同步状态表达式多一个右括号失败，拆成多行修正后通过。Browserslist 数据过旧提示不影响构建。
- 未执行真实 GitHub 写入、浏览器交互验证或远端部署。当前本机 GitHub 关闭且无同步任务。

### Owner 统一仓库调整（2026-09-25，以下为每周调整前记录）

- 前端 H5 构建、服务端 TypeScript 编译通过。
- `node --env-file-if-exists=.env --import tsx --test tests/platform.test.ts tests/format-and-stream.test.ts`：30 项通过，使用随机隔离 PostgreSQL schema 与受控 GitHub 接口。
- 验证上传原子发布/入队、私有记忆筛选、同请求并发重试、修订冲突、自动版本递增、范围保存、无变化复用及显式重新提交到新目标。
- 验证缺少 Owner 凭据时保留草稿、不创建版本或任务；12 个并发素材上传复用事务连接；目标忙时延后、租约恢复、网络重试、鉴权失败、旧任务拒绝重试。
- 验证非强制提交、分支竞争、远端已成功后去重、分支权限错误、取消记忆公开后停止旧任务。
- 本机数据库起初未启动（ECONNREFUSED 55432），按已有文档启动后通过检查。环境拒绝读取 Windows 进程命令行，本次未停止已有服务；数据库查询确认没有旧 GitHub 任务。
- 当前本机 GitHub 同步关闭，未配置实际 Owner PAT/仓库，未执行真实远端写入；尚未进行本轮浏览器交互验证或吞吐压测。
- 本地已执行 `npm run migrate`，应用 `002_owner_github.sql`；业务库没有旧 GitHub 任务，未重定向任何远端同步。

### 前期验证记录（调整前）

- `npm run build:h5`：通过；只有旧 Browserslist 数据提示，不影响构建。
- `npm run build --prefix server`：TypeScript 严格检查通过。
- `npm test --prefix server`：18 项通过，含真实 PostgreSQL 隔离 schema 的集成检查。
- 原有 11 个 `.mind`：全部能迁移并通过新 Schema；修复了 3 个 ASCII 图形字符串中的非法 JSON 转义。
- SMTP：测试使用本机临时邮件服务器；确认入队、发送和发送后删除密文验证码任务数据。
- 浏览器：本地普通测试账号登录、创建/保存草稿、勾选下载并发布版本、服务重启后会话恢复均通过。
- 模型：协议请求转换、SSE 中文/emoji 跨分片、错误终止、私有记忆过滤通过；交互集成使用可控模型适配器。
- GitHub：可控 GitHub 接口验证非强制更新、分支竞争重试、远端已成功时不重复提交、PR 未合并状态。
- 发布：勾选 GitHub 同步但未绑定仓库时明确拒绝，并验证事务回滚，不残留已发布状态或版本。
- 权限：跨账号草稿、模型连接、会话访问被拒绝；公开搜索不包含私有记忆；下架阻止继续公开生成；退出/密码重置使旧会话失效。
- 凭据：认证加密绑定账号/配置；不能把密文移动到另一个用户配置中解密；明文不在列表响应中出现。

## 未执行与仍需配置

1. **远程服务器 Docker、HTTPS、外部备份与生产恢复演练**：按用户要求暂缓。现有 Compose 文件没有被冒充为完整应用部署。
2. **真实外部联调**：需要实际 SMTP、模型 API Key、GitHub Owner PAT 与统一仓库；本轮没有真实发信、收费模型调用或远端提交。
3. **GitHub 配置**：管理员需要设置 Owner PAT、仓库和允许直接提交的分支；新版不使用 PR 或 webhook。
4. **API Key 批量轮换、自动未知文件清理**：支持密钥版本与维护清理，但没有自动批量重加密/清除未知文件命令。当前不会主动删除资源卷中的未知数据。
5. **首期范围之外**：语音克隆/TTS、群聊、向量检索、MCP/A2A、微调、交易、其他端适配未实现，仍保留在原计划后续路线。

## 架构取舍

采用模块化单体：API 与 worker 共用领域逻辑，通过 PostgreSQL 事务和任务表协作，未引入 Redis 或微服务。网页、第三方 API 和后台任务使用相同格式与资源权限规则。凭据在服务端，Skill 只包含内容。

为先交付完整 H5 操作流程，使用一个平台页面承载目录、编辑、模型和对话视图，旧原型页面源码保留但不再注册路由。后续界面继续扩大时可按视图拆分组件；首期不改换现有 Vue/UniApp 技术栈。

## 非预期问题及处理

- 工作目录已由 `source/` 迁移到仓库根目录：重新定位后保留已有依赖、README 和基础设施改动。
- npm 默认缓存目录不可写：使用被忽略的项目内 `.npm-cache/`；移除无引用且造成依赖冲突的 Pinia 和 uni-automator。统一维护 npm lockfile，未使用的 Yarn lockfile 已删除。
- 原 H5 缺少 index.html：新增真实入口后构建通过。
- 旧样例同时存在 personality_prompt 与 characterPrompt、memory_fragments 与 subconsciousTimeline：迁移器支持两类来源，保留原内容而非只通过形式校验。
- UniApp 会改写原生控件及 CSS 标签选择器：增加 H5 原生表单适配组件与显式样式类，实测输入、提交与 checkbox 发布选项。
- 模型表单异步加载前曾读取未初始化的参数：提供初始参数对象，重载后验证页面正常渲染。
- Windows pg_ctl restricted-token 错误 87：使用同一 PostgreSQL 安装的 postgres.exe 直接启动，仅绑定本地 55432 端口。
- 本机模型域名解析可能返回代理 Fake-IP：保持地址校验，不放开内网请求；真实模型联调前需要可返回真实公网地址的网络配置。

没有提交 Git commit 或推送仓库；所有实现留在当前工作区供审阅。
