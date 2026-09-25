import { createSSRApp } from 'vue';
import App from './App.vue';
import { migrateInitialUrl } from './services/navigation.mjs';
export function createApp() {
  // Run before uni-app creates its router, including for old hash bookmarks.
  migrateInitialUrl();
  const app = createSSRApp(App);
  return {
    app,
  };
}
