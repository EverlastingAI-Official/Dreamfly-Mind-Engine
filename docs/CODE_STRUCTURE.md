# 代码结构与职责

项目保持模块化单体：H5、API 和 worker 共用格式规则与 PostgreSQL，不增加新的服务或状态管理框架。

## 前端

- `src/pages.json` 与根目录下的页面文件：注册 URL，通过 `createRoutePage` 接收 UniApp 页面生命周期。
- `src/components/PlatformWorkspace.vue`：会话恢复、页面访问权限、导航和布局。用户 ID 或角色变化时销毁旧业务面板；隐藏的缓存页在重新激活后才加载新账号数据。
- `src/components/platform/PageContent.vue`：选择当前业务面板，只提供通知和操作状态。
- `src/components/platform/*Panel.vue`：管理本页面的表单和生命周期。其他页面不会初始化它的业务状态或定时器。
- `src/composables/`：较复杂的编辑、模型配置、聊天和同步状态。`usePageUi` 仅共享通知与忙碌状态，不承载业务数据。
- `src/services/http.mjs`：JSON/SSE 传输、统一错误类型与 401 处理；可独立于 Vue 验证。
- `src/services/platform.js`：响应式账号会话与传输层组装。迟到的旧请求不能清理新账号会话。
- `src/services/navigation.mjs`：URL、查询参数、旧链接兼容与滚动恢复；导入暂存绑定账号。

页面状态属于组件实例，避免模块级保存私有草稿或聊天。聊天详情通过 ID 独立查询，列表分页不会决定详情是否存在。

## 后端

- `server/src/app.ts`：Fastify 组装、插件、响应封装与统一错误处理。
- `server/src/auth.ts`：账号会话解析、权限检查与限流；账号 HTTP 接口位于 `routes/auth.ts`。
- `server/src/routes/`：HTTP 输入、响应和接口注册。`schemas.ts` 的请求结构由每条路由显式引用；`openapi.ts` 只补充文档元数据。
- `server/src/services/`：Skill 发布与权限、素材存储、包导入导出、会话、模型配置/传输，以及 GitHub 调度/同步。worker 直接调用业务模块，不导入路由。
- `server/src/types.ts`：服务端核心数据类型。数据库查询在需要跨模块使用的边界明确标注返回类型。
- `packages/mind-format/`：前后端共用的格式、迁移、发布范围规则及 TypeScript 声明。
- `server/src/logging.ts`：记录错误类型、错误码、状态和堆栈位置，不记录上游请求体、SQL 参数或凭据。

发布的事务和并发控制保留在 Skill 服务中；网络调用仍在后台任务中进行。小型路由内的简单查询无需额外包装成通用仓储。

## 归档与验证

- `archive/uniapp-prototype/`：未注册的旧页面及其素材，仅供参考，不参与构建。
- `server/tests/fixtures/legacy-minds/`：独立的旧格式迁移样例。
- `tests/frontend/`：实际页面外壳的账号切换/角色降权生命周期，以及请求错误、旧请求竞争和 SSE 截断回归。
- `server/tests/`：格式、协议与隔离数据库集成测试，覆盖超过 200 条的旧会话访问、单次 SSE 结束事件、素材错误和发布权限。

`npm run format` 使用固定版本的 Prettier。`npm run test:frontend`、`npm run test:routing`、`npm test --prefix server` 分别运行对应检查；服务端集成测试使用独立 schema，不重置业务表。
