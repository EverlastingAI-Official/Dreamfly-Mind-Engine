import http from "node:http";
import https from "node:https";
import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { paths } from "../src/services/navigation.mjs";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
};

export function createH5Server({
  root = path.resolve("dist/build/h5"),
  apiTarget = "http://127.0.0.1:3001",
} = {}) {
  const base = path.resolve(root);
  const routes = new Set([
    "/",
    "/index",
    "/pages/platform/index",
    "/sync/github",
    ...Object.values(paths),
  ]);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/v1" || url.pathname.startsWith("/api/v1/")) {
      const upstream = new URL(apiTarget);
      upstream.pathname = url.pathname;
      upstream.search = url.search;
      const request = (upstream.protocol === "https:" ? https : http).request(
        upstream,
        { method: req.method, headers: req.headers },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      request.on("error", () => {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: { code: "API_UNAVAILABLE", message: "API unavailable" },
          }),
        );
      });
      req.on("aborted", () => request.destroy());
      res.on("close", () => {
        if (!res.writableEnded) request.destroy();
      });
      req.pipe(request);
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }
    try {
      const pathname = decodeURIComponent(url.pathname);
      const isPage = routes.has(pathname);
      const missingPage =
        !isPage &&
        !path.extname(pathname) &&
        !pathname.startsWith("/assets/") &&
        !pathname.startsWith("/static/");
      const canonicalRoot = await realpath(base);
      const file = await realpath(
        path.resolve(
          canonicalRoot,
          isPage || missingPage ? "index.html" : "." + pathname,
        ),
      );
      const relative = path.relative(canonicalRoot, file);
      if (relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(missingPage || pathname === paths.missing ? 404 : 200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Content-Length": info.size,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control":
          path.extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
      });
      if (req.method === "HEAD") res.end();
      else
        createReadStream(file)
          .on("error", () => res.destroy())
          .pipe(res);
    } catch (error) {
      res.writeHead(error instanceof URIError ? 400 : 404, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Not found");
    }
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const host = process.env.H5_HOST || "127.0.0.1";
  const port = Number(process.env.H5_PORT || 4173);
  const server = createH5Server({
    root: process.env.H5_ROOT,
    apiTarget: process.env.API_PROXY_TARGET,
  });
  server.listen(port, host, () => console.log(`H5: http://${host}:${port}`));
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close());
}
