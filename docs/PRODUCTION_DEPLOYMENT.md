# Docker Compose 生产部署

## 当前实例配置（2026-09-26）

已在本机生成被 Git 忽略的 `.env.production`、`server/.env.production` 和独立生产 secrets。生产 SMTP 已沿用现有 `server/.env` 的主机、端口、TLS、账号、发件人及授权码，使用 `smtp.163.com:465` 隐式 TLS；授权码复制到 `secrets/production/smtp_password.txt`，容器通过 `/run/secrets/smtp_password` 读取。未修改开发 SMTP，也未发送测试邮件或执行外网 SMTP 验证。

`APP_ORIGIN` 已设置为 `https://soulhub.world`，宝塔代理模板同步使用该域名。根据用户截图，域名使用 Cloudflare 名称服务器；尚未检查或修改实际 DNS 记录，尚未签发证书或部署服务器。数据库密码和应用加密密钥为新版单独生成，没有迁移旧数据库。

下文初始化说明适用于新副本。配置示例仍使用占位 SMTP；当前已填写的实际配置不会由初始化脚本覆盖。上传生产版本时须单独、安全地传输上述被忽略的配置及 secrets，不能只上传 Git 跟踪文件；上传后按下文修正 Linux 文件权限。不要在服务器重新生成密钥来替代已准备好的配置。

## 适用范围与架构

目标服务器已有宝塔 Nginx 和监听 8000 的 Python `pybackend`。新版使用独立目录（建议 `/opt/dreamfly-production`）、Compose 项目 `dreamfly-production`、全新 PostgreSQL 数据卷；不修改旧项目、旧数据库、8000 端口或现有防火墙规则。

```text
用户 HTTPS → 宝塔 Nginx（域名和证书）
            → 127.0.0.1:18080 → web（H5 静态文件、API/SSE 代理）
                              → api → db / assets 卷
                              → worker → db / assets 卷、SMTP、可选 GitHub
```

`compose.production.yaml` 是独立文件，不与本地 `compose.yaml` / `compose.dev.yaml` 合并。仅 web 映射宿主机回环端口；API 和数据库没有宿主机端口。`postgres_data`、`assets` 都使用项目名前缀隔离，不能改成旧项目的数据目录或 external volume。

API 和 worker 使用同一后端镜像，各运行一个实例。迁移服务等待数据库就绪，API 和 worker 等待迁移成功。重启策略和日志轮转由 Compose 管理。数据库健康检查用于启动顺序，API 检查只表示 HTTP 进程可用，不代表 SMTP 或模型厂商可用。

前端在 Linux 构建阶段编译，后端使用 Node.js 22 和编译后的 JavaScript，运行镜像保留共享 packages、SQL 迁移和生产依赖。后端以 node 用户运行。不要把本机 Windows 的 node_modules 或实际 .env 打进镜像。

## 1. 准备配置（本机或服务器）

```sh
npm run setup:production
```

此命令无需安装项目依赖，只需 Node.js 22。它创建：

- `.env.production`：Compose 项目名、镜像标签、宿主机回环端口。
- `server/.env.production`：应用配置，包括占位域名 `https://dreamfly.example.com`。
- `secrets/production/`：独立数据库密码、验证码密钥、API Key 加密密钥；另建空 SMTP 和 GitHub 凭据文件。

重复运行保留所有已有文件，不覆盖密码或加密密钥；不读取或迁移本地开发数据库。配置和凭据已被 Git 和 Docker 构建上下文排除。不要提交它们，也不要在日志中打印内容。

如果服务器不安装 Node.js，可用后端镜像执行同一初始化脚本：

```sh
docker build --target backend -t dreamfly-backend:local .
docker run --rm --user 0 --entrypoint node \
  -v "$PWD:/workspace" -w /workspace \
  dreamfly-backend:local scripts/setup-production.mjs
```

在 Linux 上以部署账户运行 Compose。初始化脚本将生产 secrets 目录设为 0700、env 文件设为 0600；目录中的文件为 0644，使容器 node 用户可读挂载后的文件，宿主机其他用户仍受私有父目录限制。如果从 Windows 上传配置，需在服务器设置：

```sh
chmod 700 secrets/production
chmod 600 .env.production server/.env.production
chmod 644 secrets/production/*.txt
```

编辑 `server/.env.production`：

| 配置 | 说明 |
| --- | --- |
| `APP_ORIGIN` | 正式 HTTPS origin，不带路径和末尾斜杠；暂时保留占位值 |
| `SMTP_HOST/PORT/SECURE/REQUIRE_TLS/USER/FROM` | 正式发信配置；密码填入 `secrets/production/smtp_password.txt` |
| `SESSION_COOKIE_NAME` | 保留 `__Host-dreamfly_session`；生产模式继续使用 Secure Cookie |
| `TRUST_PROXY=uniquelocal` | 仅信任私网代理来源；API 不映射宿主机端口，web 重写转发地址，宝塔必须覆盖 `X-Real-IP` |
| `GITHUB_SYNC_ENABLED=false` | 默认关闭；需要时填 Owner、仓库、分支、Owner Token 后再开启 |
| `DB_POOL_MAX=5` | API 和 worker 各自的数据库连接池上限 |

数据库连接主机、数据库名、用户名和素材路径由 Compose 固定，以保持组件一致。不要加入开发用 `DATABASE_URL`，它可能把数据库连接重定向到其他实例。

域名未提供时可以构建镜像并从服务器本机检查 HTTP 页面及健康接口，但不能把这视为正式登录验收。正式域名、有效证书与 SMTP 配置齐备后才能公开启用注册/登录。无需为此关闭生产 HTTPS 或 Cookie 约束。

## 2. 服务器检查与构建

以下命令在 Linux 上、项目根目录执行：

```sh
docker version
docker compose version
ss -lnt
df -h
free -m
```

使用 Compose V2。宝塔中显示 `/usr/bin/docker-compose` 只是配置路径，尚不能证明版本与功能兼容。若只有该命令，先执行 `/usr/bin/docker-compose version` 确认是 V2，再把下文函数中的 `docker compose` 换成此路径。确认 18080 未被占用；有冲突时只修改新项目的 `WEB_PORT` 和宝塔上游地址。

为每次发布在 `.env.production` 中设置独立 `IMAGE_TAG`（例如 `release-20260926-1`）。后续每个终端会话先定义：

```sh
dc() { docker compose --env-file .env.production -f compose.production.yaml "$@"; }
dc config --quiet
docker compose --parallel 1 --env-file .env.production -f compose.production.yaml build api web
```

服务器约 2 GB 内存且有旧服务，因此串行构建、单 API/worker 起步。如果构建内存不足，在另一台具有 Docker 且架构相同的机器上构建镜像，用 `docker save` / `docker load` 传输，然后执行 `dc up -d --no-build`。不要为了构建停掉旧 backend。

## 3. 首次启动与验证

```sh
dc up -d --no-build
dc ps -a
dc logs --tail=100 migrate api worker web
curl -f http://127.0.0.1:18080/api/v1/health
curl -I http://127.0.0.1:18080/skills/detail
curl -I http://127.0.0.1:18080/static/does-not-exist.js
```

迁移容器退出码应为 0；页面直达应为 200，缺失静态文件应为 404。遇到迁移失败先看 migrate 日志，API 和 worker 不应越过失败的迁移启动。API 与数据库不需新增公网放行规则。

`web` 从应用共享路由表生成 Nginx 页面位置，支持已注册页面与旧链接刷新；未知页面以 404 返回前端入口，缺失静态资源返回普通 404，API 错误保留后端状态。两层 Nginx 均关闭代理缓冲，读取超时 180 秒，高于默认模型超时 120 秒；上传代理限制 55 MB，容纳默认 50 MB ZIP 及 multipart 开销。

域名齐备后在宝塔创建独立网站，参考 `deploy/nginx/baota.conf.example` 配置代理到 `127.0.0.1:18080`。申请并部署真实证书，保留宝塔 ACME 验证配置，不替换旧 Python 站点配置；模板的证书路径和域名不可原样上线。更换 APP_ORIGIN 后执行 `dc up -d --no-build` 重建相关容器，单纯 restart 不会更新环境变量。

正式验收：HTTPS 页面、注册验证码收取、登录和退出、详情刷新、Skill 上传与下载、流式对话、重启后的数据保留。真实邮件仅发到指定测试邮箱，模型调用与 GitHub 写入使用明确的测试范围。尚未填写 SMTP 时，worker 日志中的发信失败是预期的配置缺失，不能标记注册流程通过。

## 4. 更新与回滚

构建新版本期间旧容器继续运行。保留上一版源码、镜像标签和配置，不使用只保留 `latest` 的发布方式。

更新前先按下一节备份并停止新版项目写入，然后：

```sh
# 此时 .env.production 的 IMAGE_TAG 指向新版本，镜像已构建或导入。
dc stop web api worker
dc run --rm --no-deps migrate
dc up -d --no-build
dc ps -a
```

每次更新显式执行一次迁移，确保失败时停在迁移阶段。交互执行时，前一步失败不要继续执行下一步；写入自动发布脚本时使用 `set -e`。迁移使用数据库事务和已有迁移记录，不重复应用已完成 SQL。

如果数据库结构与旧应用兼容，将 IMAGE_TAG 改回上一版本，执行 `dc up -d --no-build`。如果不兼容，需同时按备份恢复数据库、素材和对应密钥；仅回退镜像不足以回滚数据变更。不要执行 `down -v` 或删除数据卷。

## 5. 一致性备份与恢复

备份同时包含数据库、素材和密钥。停止的只是新 Compose 项目的服务，旧 pybackend 保持运行。以下 Linux 命令需在同一终端执行；任一步失败先排查，不继续更新：

```sh
umask 077
backup_dir="backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
dc stop web api worker
dc exec -T db pg_dump -U dreamfly -d dreamfly -Fc > "$backup_dir/database.dump"
dc run --rm --no-deps -T --user 0 --entrypoint tar api -C /app/data/assets -czf - . > "$backup_dir/assets.tar.gz"
tar -czf "$backup_dir/config-secrets.tar.gz" .env.production server/.env.production secrets/production
dc start api worker web
```

备份命令不打印密钥。将备份复制到受控的独立存储，并与当前版本标签一起保存。备份中的配置和密钥属于敏感文件。

恢复演练应在独立目录进行，把 `.env.production` 的 `COMPOSE_PROJECT_NAME` 改为 `dreamfly-restore`、`WEB_PORT` 改为未占用的回环端口，例如 18081。还原配置和 secrets 文件及 Linux 权限后：

```sh
# 使用与备份配套的应用镜像；演练不能启动 worker，避免投递旧任务。
dc up -d db
# 等 dc ps 显示 db healthy，再执行下面命令。
dc exec -T db pg_restore -U dreamfly -d dreamfly --exit-on-error < /path/to/database.dump
dc run --rm --no-deps -T --user 0 --entrypoint sh api -c \
  'tar -xzf - -C /app/data/assets && chown -R node:node /app/data/assets' < /path/to/assets.tar.gz
dc up -d --no-build api web
```

目标数据库和素材卷必须全新，不能将恢复命令对准运行中的生产项目。核对内容与关键记录后，正式灾难恢复才启动 worker 并切换入口。初始化生产密钥脚本不能代替找回备份中的原加密密钥。

## 配置依据与验证边界

启动依赖采用 Docker 官方说明中的 [service_healthy 与 service_completed_successfully](https://docs.docker.com/compose/how-tos/startup-order/)。流式代理行为参照 [Nginx proxy_buffering 文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)。

仓库中的配置准备与服务器部署是两个阶段。服务器截图只能确认 Docker 已开启、容器列表为空及已有软件，不能代替镜像构建、Compose 启动、SMTP 投递和 HTTPS 验收；各项实际验证应记录在 IMPLEMENTATION_STATUS.md。
