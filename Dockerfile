# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS backend-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
COPY packages /app/packages
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS backend
ENV NODE_ENV=production
WORKDIR /app/server
COPY --from=backend-build /app/server/package.json ./package.json
COPY --from=backend-build /app/server/node_modules ./node_modules
COPY --from=backend-build /app/server/dist ./dist
COPY --from=backend-build /app/packages /app/packages
COPY server/migrations ./migrations
RUN mkdir -p /app/data/assets && chown node:node /app/data/assets
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY packages ./packages
COPY scripts/build-nginx-pages.mjs ./scripts/build-nginx-pages.mjs
ENV VITE_API_BASE_URL=/api/v1
RUN npm run build:h5 && node scripts/build-nginx-pages.mjs /app/nginx-pages.conf

FROM nginx:stable-alpine AS web
COPY deploy/nginx/container.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/nginx-pages.conf /etc/nginx/dreamfly-pages.conf
COPY --from=frontend-build /app/dist/build/h5 /usr/share/nginx/html
EXPOSE 8080
