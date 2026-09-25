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
- `POST /skills`、`PATCH /skills/{id}`：`{content: <mind>}` 保存草稿。
- `POST /skills/{id}/publish`：`{listed, chat, download, github, memory_ids: [], asset_keys: []}`。
- 发布字段分别控制目录、交互、下载和 GitHub 分发；记忆/素材默认不公开，只有显式列出的内容进入公共交互和导出。
- `GET /skills?scope=mine` 返回当前用户资源，默认查询公开目录，支持 search 与 page。
- `GET /skills/{id}/export?version=<version_id>` 返回 ZIP。参数是平台版本 ID，不是 `1.0.0` 字符串。
- `POST /assets` 接收一个 multipart 文件，返回 id 与规范资源 reference，可写入 `mind.assets`。

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

`POST /github/connect` 返回 install_url 和 authorize_url。完成绑定后使用 `/github/connections`、`/github/repositories?connection_id=...` 选择目标。

`PUT /skills/{id}/github-target` 接收 `{connection_id, repo_id, branch, mode}`，mode 为 commit 或 pr。发布版本时启用 github 后自动排队；`GET /sync-jobs` 查看 queued/running/succeeded/failed/awaiting_merge/closed 状态。

`POST /sync-jobs/{id}/retry` 只允许重试当前用户的失败任务。Webhook 使用原始请求体校验 HMAC 签名，独立于浏览器会话与 CSRF。

## 格式与权限边界

规范由 `packages/mind-format/index.js` 的 mindSchema 定义。SKILL.md 和 mind.json 人格不一致时返回 PERSONA_CONFLICT；不执行上传的 JavaScript。发布作者信息不等同于数据库 owner_id。

公开列表只搜索公开名称/说明，不以私有记忆进行搜索，避免通过搜索结果推断隐私。对话输出以普通文本渲染，不执行模型生成的 HTML。
