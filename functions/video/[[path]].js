/**
 * Cloudflare Pages Function — /video/<bookId>/<chapterId>.mp4
 *
 * 原站剧集视频是 CloudFront 签名直链，签名只有 24 小时有效期。
 * 这个端点负责：
 *   1. 从同源 /data/books/<bookId>.json 取该集地址；
 *   2. 检查 Expires 是否临近过期（默认 < 6 小时就重签）；
 *   3. 过期则回源抓 https://www.dramabox.com/es/drama/<id>/<slug>，正则取出新的签名地址；
 *   4. 302 到可播放的直链（浏览器 <video> 自动跟随）。
 * 重签结果进 Cache API（6 小时），避免每次播放都回源。
 */

const ORIGIN = 'https://www.dramabox.com';
const UA =
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const FRESH_MARGIN_MS = 6 * 3600 * 1000; // 距过期不足 6 小时就重签
const CACHE_TTL = 6 * 3600;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

function text(msg, status) {
  return new Response(msg, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function expiresAt(url) {
  const m = url && url.match(/Expires=(\d+)/);
  return m ? Number(m[1]) * 1000 : 0;
}

/** 从原站剧集页 HTML 里抠出某一集的签名 mp4 */
async function resign(bookId, slug, chapterId) {
  const url = `${ORIGIN}/es/drama/${bookId}/${encodeURIComponent(slug || 'drama')}`;
  let html = '';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'es-ES,es;q=0.9',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  // chapterList 里每个对象形如 {"id":"585509625","name":...,"unlock":true,"mp4":"https://...","m3u8Flag":false}
  const re = new RegExp(
    '\\{"id":"' + chapterId + '"[\\s\\S]{0,600}?"mp4":"(https:[^"]+)"'
  );
  const m = html.match(re);
  if (m) return m[1].replace(/\\u0026/g, '&');

  // 兜底：整页第一个带签名的 mp4（通常是第 1 集），至少保证不空
  const any = html.match(/"mp4":"(https:[^"]+\.mp4\?[^"]+)"/);
  return any ? any[1].replace(/\\u0026/g, '&') : null;
}

async function readBook(env, request, bookId) {
  const assetUrl = new URL(`/data/books/${bookId}.json`, request.url);
  try {
    const res = env && env.ASSETS && typeof env.ASSETS.fetch === 'function'
      ? await env.ASSETS.fetch(new Request(assetUrl.toString()))
      : await fetch(assetUrl.toString());
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function onRequestGet(context) {
  const { request, params = {}, env } = context;
  const raw = params.path;
  const segs = Array.isArray(raw) ? raw : String(raw || '').split('/').filter(Boolean);
  const bookId = String(segs[0] || '').replace(/\.mp4$/i, '');
  const chapterId = String(segs[1] || '').replace(/\.mp4$/i, '');

  if (!/^\d+$/.test(bookId) || !/^\d+$/.test(chapterId)) return text('bad request', 400);

  const book = await readBook(env, request, bookId);
  if (!book) return text('libro no encontrado', 404);

  const list = book.chapterList || [];
  const ch =
    list.find((c) => String(c.id) === chapterId) ||
    list.find((c) => String(c.index + 1) === chapterId) ||
    null;
  if (!ch) return text('episodio no encontrado', 404);
  if (!ch.unlock && !ch.mp4) return text('episodio bloqueado', 403);

  let url = ch.mp4 || '';
  const slug = book.slug || (book.bookInfo && book.bookInfo.bookNameEn) || 'drama';

  if (expiresAt(url) < Date.now() + FRESH_MARGIN_MS) {
    // 先看边缘缓存里有没有刚签好的
    const cache = globalThis.caches && caches.default;
    const cacheKey = new Request(new URL(`/video/${bookId}/${chapterId}.mp4`, request.url).toString());
    let hit = cache ? await cache.match(cacheKey) : null;
    let fresh = hit ? hit.headers.get('x-signed-url') : null;

    if (!fresh || expiresAt(fresh) < Date.now() + FRESH_MARGIN_MS) {
      const signed = await resign(bookId, slug, chapterId);
      if (signed) {
        fresh = signed;
        if (cache) {
          await cache.put(
            cacheKey,
            new Response('ok', {
              headers: {
                'x-signed-url': fresh,
                'Cache-Control': `public, max-age=${CACHE_TTL}`,
              },
            })
          );
        }
      }
    }
    if (fresh) url = fresh;
  }

  if (!url) return text('video no disponible', 404);

  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Cache-Control': 'private, max-age=0, no-store',
      'X-Video-Source': 'dranabox-clone',
    },
  });
}
