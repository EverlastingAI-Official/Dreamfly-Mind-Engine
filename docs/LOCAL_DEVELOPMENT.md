# 本地运行与配置

本轮交付本地应用，不执行远程服务器或 Docker 部署。现有 Compose 基础设施文件保留，尚未补为完整生产应用部署。

## 1. 当前实现

- H5：注册/登录/密码重置、公开目录、个人 Skills、编辑/上传/发布、模型连接、独立对话、GitHub 目标与同步状态、账号与管理入口。
- 后端：Fastify + TypeScript；PostgreSQL 会话与业务数据；数据库迁移；邮件与 GitHub worker。
- 格式：`packages/mind-format` 共享 Schema/迁移/导出；JSON、旧 `.mind/.mind.js`、SKILL.md、ZIP；素材保持私有直至明确发布。
- 模型：OpenAI 兼容、Anthropic Messages、Gemini generateContent 三协议；用户自己的加密连接档案；流式文本和用量。
- GitHub：App 安装与用户授权、仓库验证、单版本提交、PR 模式、去重恢复、失败重试、签名 webhook。

当前 Web 入口为 `src/pages/platform/index.vue`。旧页面源码保留作参考，但从路由表移除；新平台替代原有缺页路由和模拟控制台，不再运行浏览器直连模型代码。新页面优先 H5，使用原生浏览器表单控件；本次没有验证小程序或 App 编译。

## 2. 环境与安装

需要 Node.js 22 或 24、npm、PostgreSQL。当前本机验证使用 Node 24.14.1、PostgreSQL 18.1；已有 Compose 声明 PostgreSQL 17，SQL 不依赖 18 专属特性，CI 使用 17。

从项目根目录运行：

```powershell
npm.cmd ci
npm.cmd ci --prefix server
npm.cmd run setup:local --prefix server
```

`setup:local` 仅创建不存在的 `server/.env` 和本地 `secrets/` 文件，不覆盖已有配置或密钥。应用不是 Python 项目，无需运行 conda.exe 或 Python。

## 3. PostgreSQL

配置 `server/.env` 的 PGHOST、PGPORT、PGDATABASE、PGUSER，以及 PGPASSWORD 或 PGPASSWORD_FILE。PGPASSWORD_FILE 由应用读取，psql 不会自动读取它。

本轮为验证创建了专用本地实例：

| 项目 | 当前值 |
| --- | --- |
| 地址 | `127.0.0.1:55432` |
| 数据库/用户 | `dreamfly` |
| 数据目录 | `data/postgres-local/` |
| 密码文件 | `secrets/postgres_password.txt` |

数据和 secrets 已忽略，不会提交到 Git。服务进程结束后可使用本机安装的 PostgreSQL 工具恢复运行。不要把普通开发账号直接用作生产数据库管理员。

当前 Windows 沙箱中的 pg_ctl 因“无法创建 restricted token，错误 87”启动失败；直接运行同一安装目录的 postgres.exe 已验证可用：

```powershell
& 'C:\msys64\mingw64\bin\postgres.exe' -D D:/gitstore/dreamfly/data/postgres-local -p 55432 -h 127.0.0.1
```

这是当前机器的路径；其他机器使用各自安装的 PostgreSQL。初次建库应使用 PostgreSQL 的 initdb/createdb 或数据库管理工具，密码与 `.env` 保持一致。

数据库就绪后：

```powershell
npm.cmd run migrate --prefix server
```

迁移使用事务和数据库互斥锁，已执行的迁移不会重复应用；从不自动清空已有数据库。

## 4. 启动应用（各命令一个终端）

```powershell
# 后端 API，127.0.0.1:3001
npm.cmd run dev --prefix server

# 邮件和 GitHub 后台任务
npm.cmd run worker --prefix server

# 可选：纯本地开发收件箱，SMTP 1025 / Web 8025
npm.cmd run dev:mail --prefix server

# H5，127.0.0.1:5173
npm.cmd run dev:h5
```

打开 [本地平台](http://127.0.0.1:5173) 和 [本地收件箱](http://127.0.0.1:8025)。开发收件箱只监听回环地址，不投递外部邮件；邮件仅存进程内存，重启清空。生产环境禁止运行这个收件箱。

保持前端地址与 `APP_ORIGIN=http://127.0.0.1:5173` 一致；不要混用 localhost 和 127.0.0.1，否则状态变更请求会被 Origin 校验拒绝。前端自动通过 Vite `/api/v1` 代理调用后端。后端及 worker 源码变化后需要重启，前端支持热更新。

本轮浏览器验收创建的本地示例账号为 `preview@example.test`，密码 `LocalPreviewOnly-2026`，只有普通用户权限；其中“本地验收示例”不含真实个人资料。它仅位于当前被忽略的开发数据库，并非代码中的默认账号或生产种子。也可以在页面自行注册新账号，验证码在本地收件箱查看。

## 5. 邮箱身份与凭据

- 注册：申请验证码→收件箱查看→填写验证码和密码→注册→邮箱密码登录。
- 登录 Cookie 在服务端持久化；修改/重置密码或退出全部设备会撤销账号会话。
- `server/.env.example` 提供完整 SMTP 配置；改为真实 SMTP 后需同时重启 API 和 worker。
- 密码使用 Argon2id；API Key 和待发送验证码使用认证加密；短验证码保存带服务端密钥的摘要。
- 主密钥文件必须保留，否则已保存模型凭据无法解密。轮换时旧版本使用 `API_KEY_ENCRYPTION_KEY_V<旧版本>` 或对应 `_FILE`，完成迁移后再移除旧密钥；本轮没有自动批量轮换命令。

## 6. 模型连接

登录后进入“模型连接”，选择厂商、输入自己的 API Key、填写模型 ID并确认发送范围，保存后测试连接，再设为默认。

- 列模型失败时可以手动填写 ID；部分厂商/模型不支持相同参数，请根据错误调整配置。
- 测试连接发送最小真实请求，可能产生用量；本轮未使用真实厂商密钥进行收费调用。
- 输入字符预算是应用层近似预算，不是各厂商的精确 token 上限；超长人格/当前消息会拒绝，记忆按完整片段选择，历史按窗口保留。
- 开始会话后固定厂商/模型配置；默认连接变化不影响旧会话。旧会话可显式切换后续模型。
- 自定义连接仅接受公开 HTTPS/443，实际连接地址经过 DNS 校验和绑定，拒绝内网、回环和元数据地址。
- 若本机代理启用了将厂商域名解析为 `198.18.x.x` 的 Fake-IP，地址校验会拒绝它；使用能够返回真实公网地址的 DNS/网络配置再联调，不能为此放开任意内网访问。当前环境观察到了这种解析情况。

## 7. GitHub App

创建并安装自己的 GitHub App，至少授权 Contents 读写，PR 模式额外授权 Pull requests 读写。配置：

```dotenv
GITHUB_SYNC_ENABLED=true
GITHUB_APP_SLUG=your-app-slug
GITHUB_APP_ID=...
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET_FILE=../secrets/github_client_secret.txt
GITHUB_APP_PRIVATE_KEY_FILE=../secrets/github_private_key.pem
GITHUB_WEBHOOK_SECRET_FILE=../secrets/github_webhook_secret.txt
GITHUB_CALLBACK_URL=http://127.0.0.1:5173/api/v1/github/callback
```

用户授权回调地址需与配置一致。在页面点击绑定：先安装 App 到指定仓库，再进行当前用户授权。后端用用户令牌验证安装/仓库访问，并用 App 安装令牌提交；不能通过伪造 installation_id 借用其他人的权限。

按 Skill 设置仓库、已有目标分支及 commit/PR 模式，在发布预览中勾选 GitHub 分发。worker 自动创建提交；公开内容与在线私有草稿分开。仓库为空时直接提交模式会创建初始化 README；PR 模式需要已有基础分支。

PR 创建只代表 `awaiting_merge`。合并状态由签名 webhook 更新，App 需订阅 Pull request 和 Installation 事件；本机没有公共 webhook 地址时，PR 状态将保持等待，直到配置可到达的回调。本轮没有设置公网隧道或开放服务器。

GitHub 用户授权过期或撤销后任务会要求重新绑定。OAuth 用户令牌保存在加密连接中，本轮不自动刷新过期用户令牌。App 配置缺失时页面明确显示未启用，不虚构同步成功。

## 8. 校验与维护

```powershell
npm.cmd run build:h5
npm.cmd run build --prefix server
npm.cmd test --prefix server
npm.cmd run maintenance --prefix server
```

集成测试使用当前配置数据库中的随机隔离 schema，测试结束只清理其自行创建的 schema，不截断业务表；数据库用户需有建 schema 权限。模型和 GitHub 测试使用受控适配器；SMTP 测试使用本机临时端口。

维护命令清理过期账号会话、验证码、限流计数、授权 state 与旧邮件任务。素材删除必须不再被草稿/版本引用；本轮没有自动删除文件卷中未知文件，避免误删用户资料。

授予已注册账号管理员权限：

```powershell
npm.cmd run admin --prefix server -- registered-email@example.com
```

重新登录后出现管理入口。管理员可下架内容和停用账号，不能通过接口读取用户 API Key。不要为普通用户开放该运维命令。

备份前停止写入，使用 `pg_dump` 备份数据库，同时保留 `data/assets/` 和单独保护的 `secrets/`。远程备份调度、TLS、生产容器和灾难恢复演练随服务器部署阶段完成，本轮未宣称已完成。

## 9. 当前验证与边界

已通过：H5 构建、TypeScript 编译、18 项测试（包含嵌套集成检查），以及浏览器登录/草稿保存/版本发布/重启会话恢复。

真实外部联调仍需你的 SMTP、模型和 GitHub App 配置：未验证真实邮件投递、收费模型响应、真实仓库提交/PR 合并 webhook。服务器 Docker 部署按要求暂缓。语音素材上传不等于语音克隆，MCP/A2A、群聊、微调等仍按计划后续路线处理。
