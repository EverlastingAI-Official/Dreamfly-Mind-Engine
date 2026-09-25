// One address book for uni-app pages, queries, login returns and shared links.
export const paths = {
  explore: '/explore',
  detail: '/skills/detail',
  mine: '/skills/mine',
  new: '/skills/new',
  edit: '/skills/edit',
  chat: '/chat',
  models: '/settings/models',
  account: '/settings/account',
  admin: '/admin',
  login: '/login',
  register: '/register',
  reset: '/reset-password',
  missing: '/not-found',
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validId = (value) => typeof value === 'string' && uuid.test(value);
export const authPages = ['login', 'register', 'reset'];
export const privatePages = ['mine', 'new', 'edit', 'chat', 'models', 'account', 'admin'];

export function exploreQuery(input = {}) {
  const result = {};
  const search = String(input.search || '')
    .trim()
    .slice(0, 200);
  if (search) result.search = search;
  if (['liked', 'favorites'].includes(input.collection)) result.collection = input.collection;
  if (['zh', 'en'].includes(input.language)) result.language = input.language;
  if (['oldest', 'name', 'likes'].includes(input.sort)) result.sort = input.sort;
  for (const key of ['download', 'chat'])
    if (input[key] === true || input[key] === 'true') result[key] = 'true';
  const page = Number(input.page);
  if (Number.isSafeInteger(page) && page > 1 && page <= 1000000) result.page = String(page);
  return result;
}

export function pageUrl(name, query = {}) {
  if (!Object.hasOwn(paths, name)) throw new Error(`Unknown page: ${name}`);
  const path = paths[name];
  const values = name === 'explore' ? exploreQuery(query) : query;
  const params = new URLSearchParams(
    Object.entries(values).filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    ),
  );
  return path + (params.size ? `?${params}` : '');
}

export function safeReturnTo(value, fallback = paths.explore) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\#\r\n]/.test(value)
  )
    return fallback;
  const url = new URL(value, 'https://local.invalid');
  const name = Object.keys(paths).find((key) => paths[key] === url.pathname);
  if (!name || authPages.includes(name) || name === 'missing') return fallback;
  const q = Object.fromEntries(url.searchParams);
  if (['edit', 'detail'].includes(name) && !validId(q.id)) return fallback;
  if (name === 'chat' && q.id && !validId(q.id)) return fallback;
  if (name === 'explore') return pageUrl(name, q);
  return pageUrl(name, q.id ? { id: q.id } : {});
}

export function initialUrl(location) {
  const legacy = location.hash?.startsWith('#/')
    ? new URL(location.hash.slice(1), location.origin)
    : null;
  const url = legacy || new URL(location.href);
  if (url.pathname === '/sync/github') return paths.mine;
  if (
    url.pathname === '/pages/platform/index' ||
    (url.pathname === '/' && url.searchParams.has('view'))
  ) {
    if (validId(url.searchParams.get('skill')))
      return pageUrl('detail', { id: url.searchParams.get('skill') });
    const view = url.searchParams.get('view') || 'explore';
    if (view === 'github') return paths.mine;
    if (view === 'edit')
      return validId(url.searchParams.get('id'))
        ? pageUrl('edit', { id: url.searchParams.get('id') })
        : paths.mine;
    if (view === 'detail') return paths.explore;
    return pageUrl(Object.hasOwn(paths, view) ? view : 'explore');
  }
  if (url.pathname === '/' || url.pathname === '/index')
    return pageUrl('explore', Object.fromEntries(url.searchParams));
  const name = Object.keys(paths).find((key) => paths[key] === url.pathname);
  if (!name) return paths.missing;
  const query = Object.fromEntries(url.searchParams);
  if (name === 'explore') return pageUrl(name, query);
  if (authPages.includes(name))
    return pageUrl(name, query.returnTo ? { returnTo: safeReturnTo(query.returnTo) } : {});
  return pageUrl(name, query);
}

export function migrateInitialUrl() {
  const next = initialUrl(window.location);
  if (next !== window.location.pathname + window.location.search || window.location.hash)
    history.replaceState(history.state, '', next);
}

export function currentUrl() {
  return window.location.pathname + window.location.search;
}
export function navigate(name, query = {}, replace = false) {
  return navigateUrl(pageUrl(name, query), replace);
}
export function navigateUrl(url, replace = false) {
  if (url === currentUrl()) return Promise.resolve();
  // uni-app encodes query values again before calling its H5 router. Redirect
  // that transition to the canonical query, retaining uni-app's page lifecycle
  // and history state. Keep the workaround here, away from business pages.
  const target = new URL(url, window.location.origin);
  const removeGuard = routerWithHooks.beforeEach((to) => {
    if (to.path !== target.pathname) return;
    removeGuard();
    if (to.fullPath !== url)
      return {
        path: target.pathname,
        query: Object.fromEntries(target.searchParams),
      };
  });
  return new Promise((resolve, reject) =>
    uni[replace ? 'redirectTo' : 'navigateTo']({
      url,
      success: resolve,
      fail: reject,
    }),
  ).finally(removeGuard);
}
export function loginUrl(returnTo = currentUrl()) {
  return pageUrl('login', { returnTo: safeReturnTo(returnTo) });
}
export function signIn(returnTo = currentUrl()) {
  return navigateUrl(loginUrl(returnTo));
}
export function skillShareUrl(id) {
  return new URL(pageUrl('detail', { id }), window.location.origin).href;
}
export function rememberExplore(query) {
  sessionStorage.setItem('dreamfly-explore-url', pageUrl('explore', query));
}
export function backToExplore() {
  const target = safeReturnTo(sessionStorage.getItem('dreamfly-explore-url'));
  if (history.state?.back === target) return uni.navigateBack();
  return navigateUrl(target.startsWith(paths.explore) ? target : paths.explore);
}

let skillIntent;
export function signInForSkill(skill, action) {
  skillIntent = { id: skill.id, action };
  return signIn(pageUrl('detail', { id: skill.id }));
}
export function takeSkillIntent(id) {
  if (skillIntent?.id !== id) return null;
  const intent = skillIntent;
  skillIntent = undefined;
  return intent.action;
}

const positions = new Map();
let routerWithHooks;
export function installNavigationHooks(router) {
  if (routerWithHooks === router) return;
  routerWithHooks = router;
  router.beforeEach((to, from) => {
    positions.set(from.fullPath, window.scrollY);
  });
}
export function restoreScroll() {
  const url = currentUrl(),
    top = positions.get(url) || 0;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (currentUrl() === url) window.scrollTo(0, top);
    }),
  );
}

// Imported content stays in memory until the new-skill page consumes it.
let importedSkill;
export function stageImport(value, owner) {
  importedSkill = { value, owner };
}
export function takeImport(owner) {
  const value = importedSkill?.owner === owner ? importedSkill.value : undefined;
  importedSkill = undefined;
  return value;
}
