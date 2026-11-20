#!/usr/bin/env node
/**
 * serve.mjs — zero-dependency static server 预览 Cloudflare Pages 行为。
 *
 *   node scripts/serve.mjs            # http://127.0.0.1:4173
 *   PORT=8080 node scripts/serve.mjs
 *
 * 行为对齐 Pages：
 *   - 干净 URL：/es/browse/  -> es/browse/index.html ；/es/browse -> es/browse/index.html
 *   - .html 直出：/es/download.html -> site/es/download.html
 *   - 目录无 index：回落到 site/404.html（状态 404）
 *   - 支持 HEAD，视频/音频/分片支持 Range（m3u8/mp4 拖拽播放）
 */

import http from 'node:http';
import { promises as fs, createReadStream, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');

const PORT = Number(process.env.PORT || 4173);
const DIST = path.join(ROOT, 'dist');
const SITE = path.join(ROOT, 'site');

/** 优先级：dist（构建产物）> site（镜像源文件），方便 site 还没 build 时直接预览 */
let DOCROOT = DIST;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  // 视频 / 流媒体
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
};

const RANGE_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/mp2t', 'video/iso.segment', 'application/vnd.apple.mpegurl', 'audio/mpeg', 'audio/mp4']);

/** Pages 的特殊根文件没有扩展名，单独判定 */
const BASENAME_MIME = {
  _headers: 'text/plain; charset=utf-8',
  _redirects: 'text/plain; charset=utf-8',
  _routes: 'application/json; charset=utf-8',
};

function contentType(file) {
  const base = path.basename(file).toLowerCase();
  if (BASENAME_MIME[base]) return BASENAME_MIME[base];
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/** 缓存策略：html/无指纹资源 revalidate，静态长期缓存，media 一天 */
function cacheControl(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'public, max-age=0, must-revalidate';
  if (file.includes(`${path.sep}media${path.sep}`)) return 'public, max-age=86400';
  if (file.includes(`${path.sep}static${path.sep}`)) return 'public, max-age=31536000, immutable';
  if (['.js', '.mjs', '.css', '.woff2', '.woff', '.webp', '.avif', '.png', '.jpg', '.svg', '.ico', '.ttf'].includes(ext)) {
    return 'public, max-age=86400';
  }
  return 'public, max-age=0, must-revalidate';
}

async function statFile(p) {
  try {
    const st = await fs.stat(p);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

/** URL path -> 磁盘文件（含干净 URL / index.html / .html 回落） */
async function resolveTarget(rootDir, urlPath) {
  // 规范化：去掉 .. 防止目录穿越
  const safe = path.posix.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const rel = safe.replace(/^\/+/, '');
  const abs = path.join(rootDir, rel);

  // 1) 目录带斜杠或裸目录 -> index.html
  if (urlPath.endsWith('/')) {
    const idx = path.join(abs, 'index.html');
    const st = await statFile(idx);
    if (st) return { file: idx, stat: st, status: 200 };
  } else {
    // 2) 精确文件（.html / .css / .js / .mp4 ...）
    const st = await statFile(abs);
    if (st) return { file: abs, stat: st, status: 200 };

    // 3) 干净 URL：/es/browse -> es/browse.html 或 es/browse/index.html
    const htmlFile = `${abs}.html`;
    const stHtml = await statFile(htmlFile);
    if (stHtml) return { file: htmlFile, stat: stHtml, status: 200 };

    const idx = path.join(abs, 'index.html');
    const stIdx = await statFile(idx);
    if (stIdx) return { file: idx, stat: stIdx, status: 200 };
  }
  return null;
}

async function serve404(res, method) {
  const fallback = path.join(DOCROOT, '404.html');
  const st = await statFile(fallback);
  if (st) {
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(st.size),
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    };
    res.writeHead(404, headers);
    if (method === 'HEAD') return res.end();
    createReadStream(fallback).pipe(res);
    return;
  }
  const body = '<!doctype html><meta charset="utf-8"><title>404</title><h1>404 Not Found</h1>';
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(method === 'HEAD' ? undefined : body);
}

/** 解析 Range: bytes=start-end，返回 {start,end} 或 null（不合法时忽略） */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (!rawStart && !rawEnd) return null;
  let start;
  let end;
  if (!rawStart) {
    // bytes=-500 -> 末尾 500 字节
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

/** 解析 _redirects（只支持本项目用到的子集：# 注释、from to [status] [force]、尾部 * 通配） */
const redirectCache = { root: null, rules: [] };

function loadRedirects() {
  if (redirectCache.root === DOCROOT) return redirectCache.rules;
  const rules = [];
  try {
    const raw = readFileSync(path.join(DOCROOT, '_redirects'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const text = line.trim();
      if (!text || text.startsWith('#')) continue;
      const [from, to, statusRaw] = text.split(/\s+/);
      if (!from || !to) continue;
      const status = Number(statusRaw) || 302;
      rules.push({ from, to, status });
    }
  } catch {
    // 没有 _redirects 就当作空规则
  }
  redirectCache.root = DOCROOT;
  redirectCache.rules = rules;
  return rules;
}

function matchRedirect(urlPath) {
  for (const rule of loadRedirects()) {
    if (rule.from === urlPath) return rule;
    if (rule.from.endsWith('/*')) {
      const prefix = rule.from.slice(0, -1); // 保留末尾斜杠
      if (urlPath.startsWith(prefix)) {
        return { ...rule, to: rule.to.replace(/:\w+|\*/g, urlPath.slice(prefix.length)) };
      }
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Method Not Allowed');
  }

  let urlPath = '/';
  try {
    urlPath = decodeURIComponent(new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname);
  } catch {
    urlPath = '/';
  }

  try {
    // 0) _redirects（仅精确匹配 + 尾部 * 通配），让本地预览与 Pages 行为一致
    const rule = matchRedirect(urlPath);
    if (rule) {
      res.writeHead(rule.status, {
        Location: rule.to,
        'Cache-Control': rule.status === 301 ? 'public, max-age=3600' : 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Local-Redirect': '1',
      });
      return res.end();
    }

    let hit = await resolveTarget(DOCROOT, urlPath);

    // dist 没建好时，同一条路径去 site/ 再找一次（no build 直接预览）
    if (!hit && DOCROOT !== SITE) {
      const st = await statFile(path.join(SITE, 'index.html'));
      if (st) hit = await resolveTarget(SITE, urlPath);
    }

    if (!hit) return await serve404(res, method);

    const { file, stat, status } = hit;
    const type = contentType(file);
    const headers = {
      'Content-Type': type,
      'Cache-Control': cacheControl(file),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Accept-Ranges': 'bytes',
    };

    // Range 请求（视频拖动）
    const range = RANGE_TYPES.has(type) ? parseRange(req.headers.range, stat.size) : null;
    if (range) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
      headers['Content-Length'] = String(range.end - range.start + 1);
      res.writeHead(206, headers);
      if (method === 'HEAD') return res.end();
      return createReadStream(file, { start: range.start, end: range.end }).pipe(res);
    }

    headers['Content-Length'] = String(stat.size);
    res.writeHead(status, headers);
    if (method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  } catch (err) {
    console.error('[serve] error', err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
});

(async () => {
  const hasDist = !!(await statFile(path.join(DIST, 'index.html'))) || !!(await statFile(path.join(DIST, '404.html')));
  DOCROOT = hasDist ? DIST : SITE;
  const label = DOCROOT === DIST ? 'dist' : 'site';
  server.listen(PORT, () => {
    console.log(`[serve] root = ${label} (${DOCROOT})`);
    console.log(`[serve] http://127.0.0.1:${PORT}/  — 干净 URL / Range / 404 回落已启用`);
    if (DOCROOT !== DIST) console.log('[serve] 提示：dist\\ 尚未构建，正在直接预览 site\\');
  });
})();
