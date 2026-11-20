/**
 * Cloudflare Pages Function — /es/video/:bookSlug/:epSlug
 *
 * 路由示例（catch-all 文件 [[path]].js，所以 URL 深度灵活）：
 *   /es/video/41000110515_Escape-With-Boss-s-Baby/585509625_Episode-1
 *     -> bookSlug    = "41000110515_Escape-With-Boss-s-Baby"
 *     -> epSlug      = "585509625_Episode-1"
 *     -> bookId      = "41000110515"   (第一段下划线前的数字)
 *     -> chapterId   = "585509625"     (第二段下划线前的数字)
 *
 * 这一层【只做参数校验 + 数据落地判断】，不生成播放器 HTML（播放器页面属于另一部分工作）。
 * 行为：
 *   a. 解析 bookId / chapterId；
 *   b. 同源读取 /data/books/<bookId>.json（优先 context.env.ASSETS.fetch，回落到网络 fetch）；
 *   c. 书籍数据取不到（404 / 解析失败）-> 302 到 /es/drama/<bookId>/；
 *      参数本身不合法 -> 302 到 /es/drama/<bookId>/（拿不到 bookId 时回 /es/）；
 *   d. 书籍存在但章节不存在 -> 404 简单 HTML；
 *   e. 校验通过 -> 直出同源静态播放页（ASSETS 透传）；静态页缺失则 302 到 /es/drama/<bookId>/。
 *
 * 可扩展点（TODO）：
 *   - 校验通过后不要透传，改为在这里 fetch 上游 playUrl / 签名 m3u8，注入到播放页；
 *   - 加入 KV / D1 缓存书籍 JSON，减少 ASSETS 读次数（见注释 CACHE_HOOK）；
 *   - 章节级防盗链签名（token + 过期时间）在 ASSETS 返回前重写 media URL；
 *   - A/B 或灰度：按 country / UA 决定 302 目标（/es/ vs /en/）。
 */

const BOOKS_DIR = '/data/books/';
const DRAMA_PAGE = (bookId) => `/es/drama/${bookId}/`;
const HOME_PAGE = '/es/';

/** 只允许纯数字 ID，防止路径注入和垃圾请求 */
const DIGITS = /^\d+$/;

/** 从 "41000110515_Escape-With-Boss-s-Baby" 取 "41000110515" */
function parseId(slug) {
  if (typeof slug !== 'string' || slug.length === 0) return null;
  const head = slug.split('_')[0].trim();
  return DIGITS.test(head) ? head : null;
}

function textResponse(message, status, headers = {}) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function htmlResponse(html, status, headers = {}) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/** 简单 404 页（西语，移动端友好） */
function notFoundPage(title, detail) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  html,body{margin:0;min-height:100%;background:#0b0b0f;color:#f5f5f7;
    font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  main{display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;
    min-height:100vh;padding:24px;text-align:center}
  h1{font-size:28px;margin:0}
  p{color:#9b9ba4;margin:0}
  a{color:#ff2e63;text-decoration:none;font-weight:600}
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <p>${detail}</p>
  <a href="${HOME_PAGE}">Volver al inicio</a>
</main>
</body>
</html>`;
}

/** 302 到指定路径（Pages 里直接返回 Response，redirect: 'manual' 也可，这里用 Location 头更轻） */
function redirectTo(location, status = 302) {
  return new Response(null, {
    status,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      'X-Dranabox-Route': 'video-verify',
    },
  });
}

/** 同源读取书籍 JSON：先走 ASSETS 绑定（不产生公网回源），否则用 request.url 拼绝对地址 fetch */
async function fetchBookJson(context, bookId) {
  const assetUrl = new URL(`${BOOKS_DIR}${bookId}.json`, context.request.url);

  // CACHE_HOOK: 如果有 env.BOOKS_KV，可在这里先读 KV，命中则直接返回
  // const kv = context.env && context.env.BOOKS_KV;
  // if (kv) { const hit = await kv.get(`book:${bookId}`); if (hit) return JSON.parse(hit); }

  try {
    let res;
    if (context.env && context.env.ASSETS && typeof context.env.ASSETS.fetch === 'function') {
      // ASSETS.fetch 需要 Request 对象；带上 url 即可命中静态资源
      res = await context.env.ASSETS.fetch(new Request(assetUrl.toString(), {
        method: 'GET',
        headers: { accept: 'application/json' },
      }));
    } else {
      // 本地 wrangler pages dev / 无 ASSETS 绑定时的回落路径
      res = await fetch(assetUrl.toString(), { headers: { accept: 'application/json' } });
    }

    if (!res || !res.ok) return null;

    // 静态资源若被 404.html 之类兜底命中，content-type 会不是 JSON，这里再确认一次
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html')) return null;

    const data = await res.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/** 在书籍 JSON 里找章节：兼容 chapters / episodes / videoList 等常见结构 */
function hasChapter(book, chapterId) {
  if (!book || !chapterId) return false;

  const lists = [book.chapters, book.episodes, book.videoList, book.chapterList, book.list];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const raw = item.chapterId ?? item.id ?? item.videoId ?? item.episodeId ?? item.cid;
      if (raw === undefined || raw === null) continue;
      if (String(raw) === String(chapterId)) return true;
    }
  }

  // 有些镜像只在顶层给出章节总数与起始号段，退化为区间判断
  const count = Number(book.totalChapterNum ?? book.chapterCount ?? book.total ?? 0);
  if (Number.isFinite(count) && count > 0) {
    const first = Number(book.firstChapterId ?? 0);
    if (first > 0) {
      // 章节 ID 无法保证连续，仅作为最后的宽松判断
      return true;
    }
  }
  return false;
}

export async function onRequestGet(context) {
  const { request, params = {}, env } = context;

  // catch-all 参数在 Pages 里可能是数组，也可能是带斜杠的字符串，两种都兼容
  const raw = params.path;
  const segments = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' && raw.length
      ? raw.split('/').filter(Boolean)
      : [];

  const [bookSlug, epSlug] = segments;

  // a. 解析 bookId / chapterId
  const bookId = parseId(bookSlug);
  const chapterId = parseId(epSlug);

  // 参数不合法：能拿到 bookId 就回剧集页，否则回首页
  if (!bookId) {
    return redirectTo(HOME_PAGE);
  }
  if (!chapterId) {
    return redirectTo(DRAMA_PAGE(bookId));
  }

  // b. 读同源书籍数据
  const book = await fetchBookJson(context, bookId);

  // c. 数据取不到 -> 302 到静态剧集页（页面本身可能是 SSG 静态 HTML）
  if (!book) {
    return redirectTo(DRAMA_PAGE(bookId));
  }

  // d. 书籍在、章节不在 -> 404 简单 HTML
  if (!hasChapter(book, chapterId)) {
    return htmlResponse(
      notFoundPage(
        'Episodio no disponible',
        `El episodio ${chapterId} no pertenece a este drama.`,
      ),
      404,
      {
        'X-Dranabox-Route': 'video-verify',
        'X-Robots-Tag': 'noindex',
      },
    );
  }

  // e. 校验通过：把请求原样透传给同源静态资源（镜像好的播放页 /es/video/...）。
  //    TODO 扩展点：这里可以改为渲染播放器、注入签名播放地址、加防盗链 token 等。
  try {
    const assetUrl = new URL(request.url);
    const res = env && env.ASSETS && typeof env.ASSETS.fetch === 'function'
      ? await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: 'GET' }))
      : await fetch(assetUrl.toString(), { method: 'GET' });

    if (res && res.ok) {
      // 透传时补上鉴权通过的标记，方便排查；同时避免边缘缓存串号
      const headers = new Headers(res.headers);
      headers.set('X-Dranabox-Route', 'video-verify');
      headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
      return new Response(res.body, { status: res.status, headers });
    }
  } catch {
    // 落空 -> 走下面的 302 兜底
  }

  // 静态播放页仍未生成时，回到剧集详情页（不吐 404，用户体验更好）
  return redirectTo(DRAMA_PAGE(bookId));
}
