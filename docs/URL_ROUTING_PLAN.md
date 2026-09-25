# 无 Hash URL 整理计划

状态：2026-09-25 方案，尚未修改程序路由。

## 当前问题

- `src/manifest.json` 未配置 H5 路由模式，本地安装的 uni-app 默认使用 hash。
- `src/pages.json` 只注册 `pages/platform/index`，探索、登录、编辑、会话等大多数界面用内存中的 `view` 切换。URL 无法准确表达当前页面，刷新也不能恢复这些页面。
- `ExploreSkills.vue` 独立调用 `history.replaceState`，`locale.js` 单独拼接分享 URL；它们没有统一参与页面导航和浏览历史。
- 目前 Vite 只代理 `/api/v1`，项目没有完整的生产前端静态托管/反向代理配置。切换 History 必须同时处理深层 URL 直接访问。

## 目标地址

继续使用 uni-app 自带路由，配置 `h5.router.mode = history`、根路径部署 `base = /`。第一版使用原生页面路径和明确的查询参数承载资源 ID，不额外安装第二套路由管理器。实际页面按表中路径注册；源文件不再以 `/pages/platform/index` 作为所有功能的公共地址。

| 功能 | URL |
| --- | --- |
| 默认入口 | `/` 重定向 `/explore` |
| 探索列表 | `/explore` |
| 查询、筛选和分页 | `/explore?search=孔子&language=zh&download=true&page=2` |
| 我喜欢的 / 我的收藏 | `/explore?collection=liked` / `/explore?collection=favorites` |
| 公开详情与分享 | `/skills/detail?id=<UUID>` |
| 我的 Skills | `/skills/mine` |
| 新建 / 编辑 | `/skills/new` / `/skills/edit?id=<UUID>` |
| 会话列表 / 指定会话 | `/chat` / `/chat?id=<UUID>` |
| 模型设置 / 账号设置 | `/settings/models` / `/settings/account` |
| GitHub 同步 | `/sync/github` |
| 管理空间 | `/admin` |
| 登录 / 注册 / 重置密码 | `/login` / `/register` / `/reset-password` |

路径固定用小写英文，中英文界面共用相同地址，语言偏好继续保存在本机。查询参数保留搜索条件，省略默认值；资源 ID 始终使用数据库 UUID。

## 实施顺序

1. **统一导航入口。** 增加 `src/services/navigation.js`，集中声明页面路径、查询参数读写和分享地址生成。`locale.js` 只负责语言；删除组件直接改写浏览历史的逻辑。
2. **让路由决定当前界面。** 将现有平台页逐步拆为共用布局与页面组件，注册表中的页面。导航、创建、打开会话、查看详情都走 uni-app 路由。保留表单、请求进度等局部状态，移除与 URL 平行的全局 `view` 切页状态。
3. **还原浏览上下文。** 探索页从 URL 读取并校验筛选、排序及页码；提交查询、翻页和打开详情形成可返回的导航记录，参数归一化使用替换。返回列表恢复筛选及滚动位置；直接打开详情时仍有“返回探索”入口。
4. **统一登录与访问校验。** 私有页面跳至 `/login?returnTo=<编码后的站内地址>`。登录后恢复指定页面，returnTo 只允许已知站内路由，避免站外跳转；公开详情、登录回跳和页面刷新均从 ID 重新加载并由服务端校验权限。不把表单内容、密钥或会话令牌放入 URL。
5. **切换 History 并配置托管。** 调整 manifest 的 H5 路由设置；验证 Vite 开发环境的深层路径回退。生产反向代理先匹配 `/api/v1/` 并转发 API；静态资源缺失返回 404，前端页面路径才回退 `index.html`。让无权限、未知路由、无效 ID 或已下架内容显示明确状态。
6. **兼容旧地址。** 应用启动时识别旧 `#/pages/platform/index?skill=...` 以及已知的 `?view=...`，一次性替换为规范地址。Hash 不会发送到服务器，因此旧 hash 链接必须由前端读取迁移。旧登录/编辑链接缺少必要 ID 时返回相应列表，不能猜测目标。所有新复制链接只生成无 hash 地址。

## 定向验收

- 直接访问和刷新 `/explore`、详情、编辑及指定会话，URL 与页面内容一致。
- 查询 → 第二页 → 详情 → 浏览器后退/前进，筛选、页码、结果和滚动位置正确恢复。
- 未登录访问受限页面，登录后返回原站内地址；外部 returnTo 被拒绝。
- 新旧分享链接均打开正确 Skill；作者打开公开分享仍显示公开版本。
- 生产方式启动构建产物后，深层 URL 刷新不出现服务器 404；API 错误和缺失静态资源不会被错误替换成 HTML。
- 中英切换不改变当前资源、查询条件和 URL；无效资源显示错误页。

仅执行这些路由相关验证及前后端构建，不扩展无关测试。本阶段不改变 Skill、喜欢、收藏、版本或会话的数据模型。
