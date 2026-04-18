#!/usr/bin/env node
/* eslint-disable */
// Minimal static server used only by the Playwright visual test suite.
// Serves the viewer HTML and exposes pdfjs-dist ESM assets under /pdfjs/.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PDF_SDK_VISUAL_PORT || 4567);
const ROOT = path.resolve(__dirname, "viewer");
const PDFJS_DIST = path.resolve(
  __dirname,
  "..",
  "..",
  "node_modules",
  "pdfjs-dist",
);
const PDFJS_ROOT = path.join(PDFJS_DIST, "build");
const PDFJS_FONTS = path.join(PDFJS_DIST, "standard_fonts");
const PDFJS_CMAPS = path.join(PDFJS_DIST, "cmaps");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".map": "application/json",
  ".css": "text/css",
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, headers);
  res.end(body);
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, "Not found");
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    send(res, 200, data, { "Content-Type": type, "Cache-Control": "no-store" });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let target;
  if (url.pathname === "/" || url.pathname === "/index.html") {
    target = path.join(ROOT, "index.html");
  } else if (url.pathname.startsWith("/pdfjs/")) {
    target = path.join(PDFJS_ROOT, url.pathname.slice("/pdfjs/".length));
  } else if (url.pathname.startsWith("/pdfjs-standard-fonts/")) {
    target = path.join(
      PDFJS_FONTS,
      url.pathname.slice("/pdfjs-standard-fonts/".length),
    );
  } else if (url.pathname.startsWith("/pdfjs-cmaps/")) {
    target = path.join(
      PDFJS_CMAPS,
      url.pathname.slice("/pdfjs-cmaps/".length),
    );
  } else {
    target = path.join(ROOT, url.pathname);
  }
  // Prevent path traversal
  const resolved = path.resolve(target);
  const allowed = [ROOT, PDFJS_ROOT, PDFJS_FONTS, PDFJS_CMAPS];
  if (!allowed.some((p) => resolved.startsWith(p))) {
    return send(res, 403, "Forbidden");
  }
  serveFile(res, resolved);
});

server.listen(PORT, () => {
  console.log(`[visual-harness] listening on http://localhost:${PORT}`);
});
