# DreamFly API 使用

运行后访问 `/api/v1/openapi.json` 获取接口目录和主要请求结构。所有响应为 `{data, request_id}`，失败为 `{error: {code, message, details?}, request_id}`；ZIP 和 SSE 使用各自原生响应体。

## 会话与请求

先 `POST /auth/email-codes`（email、purpose=register），再 `POST /auth/register`（email、challenge_id、code、password、display_name）。注册不自动登录。

`POST /auth/login` 接收 email、password，返回 user、csrf，并通过 Set-Cookie 写入不透明账号会话。非浏览器调用者需要维护 Cookie jar。

带身份的修改请求必须携带 Cookie、`Origin: <APP_ORIGIN>`、`X-CSRF-Token: <csrf>`。恢复页面时 `GET /auth/me` 重新取得 user 与 csrf；不要把 user_id 当作鉴权信息。

注册、重置和修改密码要求 8–128 位，且至少包含一个英文字母和一个数字；不要求大写字母或特殊符号，也不禁止特殊符号。登录兼容已有密码。重置使用 purpose=reset_password 的邮箱挑战；`POST /auth/reset-password` 成功后旧会话失效。验证码错误次数在数据库累计，不能通过并发失败事务回滚重置。

## Skill

- `POST /skills/validate`：JSON `{content: <mind对象或旧格式文本>}`，或 multipart 文件。
- `POST /skills/import`：multipart `file`，返回规范 mind 与 warnings，同时把包内引用素材私有保存。
- `POST /skills`：`{id?: <UUID>, content: <mind>, publication?: <公开选项>}` 保存新草稿；页面打开创建表单时分配 UUID。服务端使用该 UUID（缺省则生成）分配唯一包名 `mind-<UUID>`，初始版本为 `1.0.0`，返回 id、slug 与 revision。未提供名称时使用“显示名称的mindcopy”。导入创建也分配新包名。
- `PATCH /skills/{id}`：`{revision, content: <mind>, publication?: <公开选项>}` 保存草稿，已有包名不可修改。revision 来自详情接口，过期返回 DRAFT_CHANGED；草稿公开选项保存在 draft_publication，不影响已发布权限。
- 保存草稿、创建版本和发布均要求人格指令、自我认知及至少一条记忆内容非空；只有空白字符也不通过。每条记忆都必须有内容。用途说明不再由用户填写，服务端根据名称生成兼容包格式的 description。
- `POST /skills/{id}/submit`：`{revision, request_id: <UUID>, content: <mind>, publication: {listed, chat, download, memory_ids: []}, compliance_confirmed: true}`。新建时路径使用客户端分配的 UUID，revision=0；更新时带详情接口的 revision。事务内保存内容并创建版本，不立即入队。返回 id、revision、published、version_id、version、sync_job_id（提交时为 null）和 sync_policy（weekly 或 disabled）。首次 1.0.0，后续版本自动递增补丁号；未变化的内容与范围复用原版本，仓库配置不影响平台版本。同一 request_id 重试必须携带原请求体，复用结果；修改请求体返回 REQUEST_REUSED。
- `POST /skills/{id}/publish`：兼容发布已保存草稿，接收 `{revision, request_id, listed, chat, download, memory_ids: [], compliance_confirmed: true}`，共用上述提交逻辑。必须明确确认拥有内容使用与发布授权并同意公开范围；确认标记随发布版本保存。这是用户声明与完整性检查，不是自动内容审核。
- 页面新建时默认允许目录、交互、下载，记忆默认全部勾选。关闭目录会同时关闭交互和下载；服务端也强制此联动。允许下载即纳入每周 GitHub 同步，全部素材进入下载包和同步内容；github、asset_keys 由服务端推导，不接受独立覆盖。记忆仍按 memory_ids 选择。
- 每周同步使用管理员配置的统一仓库和 Owner PAT；普通用户无需 GitHub 授权。GitHub 关闭或配置缺失不阻止保存、发布、查询、筛选和下载，内容等待后续每周调度。
- `GET /skills?scope=mine` 返回当前用户资源，默认查询公开目录，支持 search 与 page。
- `GET /skills/{id}/export?version=<version_id>` 返回 ZIP。参数是平台版本 ID，不是 `1.0.0` 字符串。
- `POST /assets` 接收一个 multipart 文件，返回 id 与规范资源 reference，可写入 `mind.assets`。页面分为图片、声音入口，先传 kind=image/audio 再传 file，后端按实际文件类型检查入口是否匹配。
- 图片、声音单文件最多 10 MB（10 × 1024 × 1024 字节），含 ZIP 包内导入素材；已有超过限制的素材在保存或发布时也会被拒绝，需要移除后重新上传。

## 模型与交互

`POST /model-profiles` 接收 name、provider、model、api_key、api_key_action、consent、parameters；custom 厂商另需 base_url、protocol。parameters 支持 max_tokens、timeout_seconds、temperature、context_chars。GET 从不返回密钥。

```json
{
  "name": "我的 DeepSeek",
  "provider": "deepseek",
  "model": "填写实际模型 ID",
  "api_key": "仅在用户设置页或自己的客户端输入",
  "api_key_action": "replace",
  "consent": true,
  "parameters": {"max_tokens": 1024, "timeout_seconds": 120, "context_chars": 24000}
}
```

保存后调用 `POST /model-profiles/{id}/test` 验证，再设置默认配置。测试调用会产生真实上游请求。

保存之前可调用 `POST /model-providers/{provider}/models`，body 为 `{api_key}`，无需模型 ID 或连接名称；返回 `[{id, name}]` 供下拉选择，不保存凭据或创建连接。编辑已有连接时可传 `{profile_id}` 复用当前用户该厂商的已保存密钥，或同时传 `api_key` 优先使用新密钥。API 地址和协议取自服务端厂商目录，不能由这个请求指定。旧的 `POST /model-profiles/{id}/models` 仍可用于已保存连接。Gemini、Anthropic 列表自动翻页，硅基流动请求聊天模型。

网页端固定厂商地址并隐藏高级参数；新建使用服务端默认参数，编辑保留原参数。模型选择失败时重试获取列表，不提供手写模型 ID 输入框。

创建会话：`POST /mindcopies/{skill_id}/sessions`，body `{version_id, profile_id}`；返回 conversation 的 id。使用访问者自己的 profile。

发送消息：`POST /conversations/{id}/messages`，body `{content, client_request_id}`，client_request_id 使用 UUID。相同 ID 重发不会重复生成。

SSE 事件：

```text
event: message.start
data: {"id":"助手消息 ID"}

event: message.delta
data: {"text":"增量文本"}

event: message.completed
data: {"id":"助手消息 ID","status":"completed","usage":null}
```

失败或取消分别为 message.failed、message.cancelled。连接中断可能留下部分文本；重新获取 `GET /conversations/{id}/messages` 确认最终状态。需要重新生成时使用新的 client_request_id，不能把整个上游调用自动重放。

旧会话模型切换：`PUT /conversations/{id}/model-profile`，body `{profile_id}`；已经开始的请求不切换。取消：`POST /conversations/{id}/messages/{message_id}/cancel`。

## GitHub

- 默认每周一 03:00（Asia/Shanghai）同步，每个 Skill 只选取调度时最新已发布且允许下载的版本；草稿不参与，周内旧版本保留在平台。
- `GET /github/status` 返回 enabled、configured、非敏感 target、schedule（frequency、timezone、weekday、local_time、next_run_at、last_error）及 latest_batch（本人最近批次）。关闭时 next_run_at 仅表示计划时间。
- `GET /github/batches?page=1` 查看本人批次，每页 20 条，包含 total、succeeded、failed、skipped、pending 计数。管理员通过 `GET /admin/github/batches` 查看平台批次。跨批次重试复用任务，计数反映关联任务的当前状态。
- `POST /admin/github/check` 仅管理员可调用，读取仓库与分支，不创建提交。可达不等于令牌具备 Contents 写权限或分支允许直接提交，需管理员确认。
- `GET /sync-jobs` 查看本人任务，支持 skill_id、batch_id、status、from（含）、to（不含）、page，每页 50 条。日期使用 ISO 时间或日期，日期按 UTC 零点解释。状态为 queued/running/succeeded/failed/skipped，包含版本、目标、错误、跳过原因及提交链接。
- `GET /admin/sync-jobs` 支持相同筛选，仅管理员可查看全部任务。
- `GET /sync-jobs/{id}` 查询本人单个任务；`POST /sync-jobs/{id}/retry` 重试本人每周批次内失败任务；管理员使用 `POST /admin/sync-jobs/{id}/retry`。保留任务 ID 和内容，目标不一致或旧即时任务不可直接重试。
- 用户绑定、仓库配置、PR 和 webhook 接口已移除。旧 App 任务保留原始 payload 与结果，停止执行且拒绝重试。新目标在每周调度时接收当前已授权版本，不因目标变化额外创建平台版本。
- 调度在数据库中持久化批次和下次时间，停机错过多周时补做一次最新内容同步；失败任务保留原标识用于恢复，成功记录按目标和版本去重。无变化只记录空批次，不创建远端提交。
- 下架、账号停用或取消记忆公开后，执行前检查不通过的任务标记 skipped；不会自动删除远端历史。
- 任务目标与当前服务配置不一致时停止执行，要求管理员核对。单向同步；下架和取消公开不会删除 GitHub 历史。

## 格式与权限边界

规范由 `packages/mind-format/index.js` 的 mindSchema 定义。SKILL.md 和 mind.json 人格不一致时返回 PERSONA_CONFLICT；不执行上传的 JavaScript。发布作者信息不等同于数据库 owner_id。

公开列表只搜索公开名称/说明，不以私有记忆进行搜索，避免通过搜索结果推断隐私。对话输出以普通文本渲染，不执行模型生成的 HTML。
