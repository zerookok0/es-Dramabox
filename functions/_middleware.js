/**
 * Cloudflare Pages 根中间件 —— 对全部请求生效（static + Functions）。
 *
 * 职责（只做两件事，保持极薄，避免拖慢静态分发）：
 *   1. HTML 响应统一补 `Cache-Control: public, max-age=0, must-revalidate`，
 *      防止镜像页更新后边缘/浏览器继续吃旧 HTML；其它响应（js/css/图片/视频/JSON）原样放行。
 *   2. `/es/` 前缀下的 404（干净 URL 缺静态页、章节页没生成等）不再吐裸 404，
 *      回落到西语首页 `/es/` 的内容，让用户仍有入口。
 *
 * 注意：Pages 的请求顺序是  静态资源 -> Functions -> _middleware，
 * 所以这里拿到的 next() 结果可能已经是静态文件；不要再重复 fetch 一遍静态资源。
 */

const ES_PREFIX = '/es/';
const CACHE_REVALIDATE = 'public, max-age=0, must-revalidate';

function isHtml(contentType) {
  return !!contentType && /text\/html/i.test(contentType);
}

export async function onRequest(context) {
  const { request, next } = context;

  // 只处理 GET/HEAD；POST 等直接放行（本项目没有接口）
  const method = (request.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return next();

  /** @type {Response} */
  const response = await next();
  const contentType = response.headers.get('content-type');
  const url = new URL(request.url);

  // —— 1) HTML：强制回源校验缓存
  if (isHtml(contentType)) {
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', CACHE_REVALIDATE);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

    if (response.status === 404 && url.pathname.startsWith(ES_PREFIX)) {
      // —— 2) /es/ 的 404 -> 渲染 /es/ 首页内容（保持 404 状态码，避免污染 SEO 索引）
      try {
        const homeUrl = new URL(ES_PREFIX, url.origin);
        const home = context.env && context.env.ASSETS && typeof context.env.ASSETS.fetch === 'function'
          ? await context.env.ASSETS.fetch(new Request(homeUrl.toString(), { method: 'GET' }))
          : await fetch(homeUrl.toString(), { method: 'GET' });

        if (home && home.ok && isHtml(home.headers.get('content-type'))) {
          headers.set('X-Dranabox-Fallback', 'es-home');
          headers.set('X-Robots-Tag', 'noindex, follow');
          headers.set('Content-Type', home.headers.get('content-type') || 'text/html; charset=utf-8');
          headers.delete('Content-Length'); // 内容变了，长度交给运行时重算
          return new Response(method === 'HEAD' ? null : home.body, {
            status: 404,
            statusText: 'Not Found',
            headers,
          });
        }
      } catch {
        // 首页也取不到：退回原始 404
      }
    }

    headers.delete('Content-Length');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  // 非 HTML：原样放行（Functions 返回的 302/JSON 也在这里通过）
  return response;
}
