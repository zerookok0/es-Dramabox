#!/usr/bin/env node
/**
 * build.mjs — zero-dependency static build for the Dranabox (dramabox.com/es) mirror.
 *
 * Output layout (dist/), matching what Cloudflare Pages serves:
 *   dist/**.html, dist/static/**, dist/media/**   <- from site/   (镜像产物)
 *   dist/_headers, dist/_redirects, dist/favicon.ico ...  <- from public/ (根级覆盖)
 *   dist/data/**                                  <- from data/   (Pages Function 读取的 JSON)
 *
 * 只使用 node:fs / node:path，可在任意 Node >= 22 上直接运行。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const DIST = path.join(ROOT, 'dist');

// 目录可用环境变量覆盖，仅用于自测，日常构建不要动（路径相对 ROOT）
const envDir = (name, fallback) => (process.env[name] ? path.resolve(ROOT, process.env[name]) : path.join(ROOT, fallback));

const SITE = envDir('SITE_DIR', 'site');
const PUBLIC = envDir('PUBLIC_DIR', 'public');
const DATA = envDir('DATA_DIR', 'data');

/** 递归统计/复制时跳过的垃圾文件（编辑器/系统产生的噪音） */
const SKIP_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** 复制统计 */
const stats = { files: 0, bytes: 0, bySource: { site: 0, public: 0, data: 0 } };

/**
 * 递归复制目录：src -> dest，合并到已存在的 dest（用于把 public/ 铺到 dist 根）。
 * @param {string} src
 * @param {string} dest
 * @param {'site'|'public'|'data'} bucket
 */
async function copyTree(src, dest, bucket) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyTree(from, to, bucket);
    } else if (entry.isSymbolicLink()) {
      // 符号链接：解析真实文件后复制内容，避免 dist 里出现悬空链接
      const real = await fs.realpath(from).catch(() => null);
      if (!real) continue;
      const st = await fs.stat(real).catch(() => null);
      if (!st || !st.isFile()) continue;
      await fs.copyFile(real, to);
      stats.files += 1;
      stats.bytes += st.size;
      stats.bySource[bucket] += 1;
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
      const st = await fs.stat(to);
      stats.files += 1;
      stats.bytes += st.size;
      stats.bySource[bucket] += 1;
    }
  }
}

/** 写入 HTML 兜底 404（只在 site/ 没提供 404.html 时生成） */
const FALLBACK_404 = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>404 — Página no encontrada</title>
<style>
  html,body{margin:0;height:100%;background:#0b0b0f;color:#f5f5f7;
    font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  main{display:flex;flex-direction:column;align-items:center;justify-content:center;
    min-height:100%;gap:16px;text-align:center;padding:24px}
  h1{font-size:56px;margin:0}
  a{color:#ff2e63;text-decoration:none;font-weight:600}
</style>
</head>
<body>
<main>
  <h1>404</h1>
  <p>La página que buscas no existe o fue movida.</p>
  <a href="/es/">Volver al inicio</a>
</main>
</body>
</html>
`;

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function humanMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

async function main() {
  const t0 = Date.now();

  // 1) 前置校验：site/ 必须存在，否则直接失败并给出清晰提示
  if (!(await exists(SITE))) {
    console.error('');
    console.error('[build] ERROR: 找不到 site\\ 目录。');
    console.error(`        期望路径: ${SITE}`);
    console.error('        site\\ 是镜像静态 HTML 的产物目录，请先生成它（负责镜像的步骤），再运行 npm run build。');
    console.error('        当前可用的顶层目录:');
    const top = await fs.readdir(ROOT, { withFileTypes: true }).catch(() => []);
    for (const d of top) {
      if (d.isDirectory()) console.error(`          - ${d.name}\\`);
    }
    console.error('');
    process.exit(1);
  }

  // 2) 清空并重建 dist/
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  // 3) site/ -> dist/
  await copyTree(SITE, DIST, 'site');

  // 4) public/* -> dist/ 根（_headers / _redirects / favicon.ico 等），后写覆盖先写
  if (await exists(PUBLIC)) {
    await copyTree(PUBLIC, DIST, 'public');
  } else {
    console.warn('[build] warn: 没有 public\\ 目录，跳过 _headers/_redirects 等根级文件。');
  }

  // 5) data/ -> dist/data（Pages Function 校验 /es/video/... 时需要读 /data/books/<id>.json）
  if (await exists(DATA)) {
    await copyTree(DATA, path.join(DIST, 'data'), 'data');
  } else {
    console.warn('[build] warn: 没有 data\\ 目录，Functions 的书籍校验将只能走 302 兜底。');
  }

  // 6) 404 兜底：site/ 没带 404.html 时生成一个最小页面
  const has404 = await exists(path.join(DIST, '404.html'));
  if (!has404) {
    await fs.writeFile(path.join(DIST, '404.html'), FALLBACK_404, 'utf8');
    const st = await fs.stat(path.join(DIST, '404.html'));
    stats.files += 1;
    stats.bytes += st.size;
    stats.bySource.site += 1;
    console.log('[build] 生成兜底 404.html');
  }

  const ms = Date.now() - t0;
  console.log(
    `[build] site=${stats.bySource.site} public=${stats.bySource.public} data=${stats.bySource.data} 用时 ${ms}ms`,
  );
  // 规范输出行：dist ready: <文件数> files, <MB>
  console.log(`dist ready: ${stats.files} files, ${humanMb(stats.bytes)} MB`);
}

main().catch((err) => {
  console.error('[build] FAILED:', err && err.stack ? err.stack : err);
  process.exit(1);
});
