import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  initialUrl,
  safeReturnTo,
  pageUrl,
  exploreQuery,
} from "../src/services/navigation.mjs";
import { createH5Server } from "./serve-h5.mjs";

test("old bookmarks, canonical queries and external login returns", () => {
  const id = "4e0f60b7-69b7-4f2e-9823-cf49a2ca9e5a";
  const initial = (input) =>
    initialUrl(new URL(input, "http://localhost:5173"));
  assert.equal(
    initial("/#/pages/platform/index?skill=" + id),
    "/skills/detail?id=" + id,
  );
  assert.equal(
    initial("/pages/platform/index?view=models"),
    "/settings/models",
  );
  assert.equal(initial("/?view=edit"), "/skills/mine");
  assert.equal(initial("/"), "/explore");
  assert.equal(initial("/sync/github"), "/skills/mine");
  assert.equal(initial("/#/pages/platform/index?view=github"), "/skills/mine");
  assert.equal(initial("/unknown"), "/not-found");
  assert.equal(
    initial("/explore?search=%E5%AD%94%E5%AD%90&page=1&sort=newest"),
    "/explore?search=%E5%AD%94%E5%AD%90",
  );
  for (const value of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/login?returnTo=/admin",
    "/api/v1/users",
    "/skills/edit?id=bad",
  ]) {
    assert.equal(safeReturnTo(value), "/explore");
  }
  assert.equal(safeReturnTo("/skills/edit?id=" + id), "/skills/edit?id=" + id);
  assert.deepEqual(
    exploreQuery({
      search: "  中文 English ",
      page: "2",
      download: true,
      collection: "favorites",
      sort: "likes",
      language: "zh",
    }),
    {
      search: "中文 English",
      collection: "favorites",
      language: "zh",
      sort: "likes",
      download: "true",
      page: "2",
    },
  );
  assert.equal(pageUrl("detail", { id }), "/skills/detail?id=" + id);
  const search = "中文 A+B & 100% %2F";
  const results = pageUrl("explore", { search, collection: "favorites" });
  assert.equal(
    new URL(results, "http://localhost").searchParams.get("search"),
    search,
  );
  const login = pageUrl("login", { returnTo: results });
  assert.equal(
    safeReturnTo(
      new URL(login, "http://localhost").searchParams.get("returnTo"),
    ),
    results,
  );
});

test("built-page fallback does not swallow API errors or missing assets", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "dreamfly-routing-"));
  const api = http.createServer((req, res) => {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end('{"error":"missing"}');
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  await writeFile(path.join(root, "index.html"), "<html>DreamFly</html>");
  await writeFile(path.join(root, "app.js"), 'console.log("app")');
  const web = createH5Server({
    root,
    apiTarget: `http://127.0.0.1:${api.address().port}`,
  });
  web.listen(0, "127.0.0.1");
  await once(web, "listening");
  t.after(async () => {
    await Promise.all([
      new Promise((resolve) => web.close(resolve)),
      new Promise((resolve) => api.close(resolve)),
    ]);
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("dreamfly-routing-"));
    await rm(root, { recursive: true });
  });
  const base = `http://127.0.0.1:${web.address().port}`;
  for (const route of [
    "/",
    "/index",
    "/sync/github",
    "/explore",
    "/skills/detail?id=example",
    "/skills/edit?id=example",
    "/chat?id=example",
    "/pages/platform/index",
  ]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /DreamFly/);
  }
  for (const route of [
    "/assets/missing.js",
    "/static/missing.png",
    "/assets/missing",
  ]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /DreamFly/);
  }
  const response = await fetch(base + "/api/v1/missing");
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "missing" });
  // Absolute-form request targets must never change the configured API host.
  const forwarded = await new Promise((resolve, reject) => {
    http
      .get(base, { path: "http://127.0.0.1:1/api/v1/missing" }, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", reject);
  });
  assert.equal(forwarded.status, 404);
  assert.deepEqual(JSON.parse(forwarded.body), { error: "missing" });
  assert.equal((await fetch(base + "/unknown")).status, 404);
  assert.match(
    (await fetch(base + "/app.js")).headers.get("content-type"),
    /javascript/,
  );
});
