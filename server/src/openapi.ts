import type { RouteOptions } from 'fastify';
export function describeRoute(route: RouteOptions) {
  const path = route.url.replace(/^\/api\/v1/, '');
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  route.schema = {
    tags: [path.split('/')[1] || 'system'],
    summary: methods.join('/') + ' ' + path,
    security: route.config?.public || route.config?.webhook ? [] : [{ session: [] }],
    ...route.schema,
  };
}
