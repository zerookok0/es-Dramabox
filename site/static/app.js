/* Dranabox 复刻版 — 交互层（原站 React 运行时已被剥离，这里补齐同等行为） */
(function () {
  "use strict";
  var D = document;
  var CFG = {};
  var APP = "DramaBox Ilimitado";
  var DL = "/es/download/";
  var PW = {};

  function hydrateCfg() {
    CFG = window.DBX || {};
    APP = CFG.appName || "DramaBox Ilimitado";
    DL = CFG.downloadUrl || "/es/download/";
    PW = CFG.paywall || {};
  }


  /* ---------- 0. 品牌与下载入口（读 config.js） ---------- */
  function applyBrand() {
    // 正文文本节点里的 DramaBox -> App 名字（跳过脚本/样式，幂等）
    if (APP !== "DramaBox") {
      var walker = D.createTreeWalker(D.body, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          var p = n.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          var tag = p.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA") return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var node;
      while ((node = walker.nextNode())) {
        var v = node.nodeValue;
        if (v && v.indexOf("DramaBox") >= 0 && v.indexOf(APP) < 0) {
          node.nodeValue = v.replace(/DramaBox/g, APP);
        }
      }
      if (D.title.indexOf("DramaBox") >= 0 && D.title.indexOf(APP) < 0) {
        D.title = D.title.replace(/DramaBox/g, APP);
      }
      qsa('meta[content*="DramaBox"]').forEach(function (m) {
        var c = m.getAttribute("content") || "";
        if (c.indexOf(APP) < 0) m.setAttribute("content", c.replace(/DramaBox/g, APP));
      });
    }

    // 顶部悬浮条：换文案 + 把「Abrir」变成下载入口
    var banner = CFG.banner || {};
    var adWrap = qs('[class*="headerAdWrap"]');
    if (adWrap) {
      var intro = qs('[class*="intro"]', adWrap);
      if (intro && banner.text) intro.textContent = banner.text;
      var btn = qs('[class*="openBtn"]', adWrap);
      if (btn) {
        var a = D.createElement("a");
        a.href = DL;
        a.className = btn.className;
        a.textContent = banner.cta || "Descargar";
        a.style.display = "inline-flex";
        a.style.alignItems = "center";
        a.style.justifyContent = "center";
        btn.parentNode.replaceChild(a, btn);
      }
    }

    // 字标：原站是 m-logo.png（横排 "DramaBox"），换成可配置的文字字标
    if (CFG.wordmarkText !== false) {
      qsa('img[class*="logoIcon"], img[class*="logoBox"]').forEach(function (img) {
        var box = img.getBoundingClientRect();
        var h = box.height || (img.getAttribute("height") || 21) * 1;
        var span = D.createElement("span");
        span.className = "db-wordmark";
        span.setAttribute("aria-label", APP);
        var html = APP.replace(/(\S+)\s+(.+)$/, function (m, a, b) {
          return a + " <em>" + b + "</em>";
        });
        // PC 头部字标：保留原 app 图标，再接文字
        if (/logoIcon/.test(img.className)) {
          html = '<img class="db-wm-ico" src="/static/img/logo.png" alt="">' + html;
        }
        span.innerHTML = html;
        span.style.height = Math.max(18, h) + "px";
        span.style.lineHeight = Math.max(18, h) + "px";
        span.style.fontSize = Math.max(15, Math.round(h * 0.78)) + "px";
        img.replaceWith(span);
      });
    }

    // 下载页 / 底部「Descargar」等入口统一指向配置地址
    qsa('[class*="EpisodeNav"] a, [class*="EpisodeNav"] div').forEach(function (el) {
      if ((el.textContent || "").trim() === "Descargar" && !el.dataset.dbDl) {
        el.dataset.dbDl = "1";
        el.style.cursor = "pointer";
        el.addEventListener("click", function (e) {
          e.preventDefault();
          openDownloadNotice();
        });
      }
    });
  }

  /* ---------- 1. rem 适配（还原原站 750 设计稿缩放） ---------- */
  function setRem() {
    var w = D.documentElement.clientWidth || window.innerWidth;
    if (w <= 768) D.documentElement.style.fontSize = (100 * w) / 750 + "px";
    else D.documentElement.style.fontSize = "100px";
    D.documentElement.style.setProperty("--vh", window.innerHeight / 100 + "px");
  }
  setRem();
  window.addEventListener("resize", setRem, { passive: true });

  function qs(s, r) { return (r || D).querySelector(s); }
  function qsa(s, r) { return Array.prototype.slice.call((r || D).querySelectorAll(s)); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }

  /* ---------- 2. 图片兜底 ---------- */
  D.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t.tagName === "IMG" && !t.dataset.fb) {
      t.dataset.fb = "1";
      t.style.background = "#1b1b1f";
      t.removeAttribute("src");
    }
  }, true);

  /* ---------- 2.1 惰性图片补全（原站由 react-lazyload 在客户端注入封面） ---------- */
  var INDEX = null;
  function loadIndex() {
    if (INDEX) return Promise.resolve(INDEX);
    return fetch("/data/index.json").then(function (r) { return r.json(); }).then(function (d) {
      INDEX = d;
      return d;
    });
  }

  function hydrateLazy() {
    var wraps = qsa(".lazyload-wrapper").filter(function (w) { return !w.dataset.done; });
    if (!wraps.length) return;
    loadIndex().then(function (d) {
      var map = {};
      (d.books || []).forEach(function (b) { map[b.bookId] = b; });
      wraps.forEach(function (w) {
        var scope = w.closest('[class*="itemBox"],[class*="cardBox"],[class*="item"]') || w.parentElement;
        var a = w.closest("a") || (scope && scope.querySelector('a[href*="/es/drama/"]'));
        var href = (a && a.getAttribute("href")) || "";
        var m = href.match(/\/es\/drama\/(\d+)/);
        if (!m) return;
        var b = map[m[1]];
        if (!b || !b.cover) return;
        var img = D.createElement("img");
        img.src = b.cover;
        img.alt = b.name || "";
        img.loading = "lazy";
        img.decoding = "async";
        img.className = "index-module-scss-module__K_SZ3G__imageItem";
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        img.style.display = "block";
        w.innerHTML = "";
        w.appendChild(img);
        w.dataset.done = "1";
      });
      normalizeImages();
    }).catch(function () { });
  }


  /* ---------- 2.2 卡片封面尺寸归一（原站靠 React 布局，SSR 图会缩成一半） ---------- */
  function normalizeImages() {
    qsa('img[class*="imageItem"], .lazyload-wrapper > img, [class*="imageLazyBox"] > img').forEach(function (img) {
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      img.style.display = "block";
    });
  }


  /* ---------- 2.5 Facebook Pixel ---------- */
  function initPixel() {
    var id = (CFG.fbPixelId || "").trim();
    if (!/^\d{6,}$/.test(id)) return;
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    /* eslint-enable */
    window.fbq("init", id);
    window.fbq("track", "PageView");
  }

  function track(evtName, params) {
    if (!window.fbq) return;
    try {
      window.fbq("track", evtName, params || CFG.fbParams || {});
    } catch (e) { /* 埋点失败不影响下载 */ }
  }

  /* ---------- 2.6 第三方下载安全提示 ---------- */
  var noticeOpen = false;

  function openDownloadNotice() {
    if (noticeOpen) return;
    // 应用内引导：默认关闭（onDownload:false），WebView 里也直接跳转
    if (inAppBrowser() && (CFG.inAppGuide || {}).onDownload !== false) {
      showInAppGuide();
      return;
    }

    var n = CFG.downloadNotice || {};
    var ev = (CFG.fbEvents || {});

    // 关掉安全提示：点下载 = 直接进下载页，同时回传两个事件
    if (n.enabled === false) {
      track(ev.checkout || "InitiateCheckout");
      track(ev.purchase || "Purchase");
      window.location.href = DL;
      return;
    }

    // 点「下载」= 发起结账
    track(ev.checkout || "InitiateCheckout");

    var steps = (n.steps || []).map(function (t, i) {
      return '<li><span class="db-step-n">' + (i + 1) + "</span><span>" + t + "</span></li>";
    }).join("");

    var w = modal(
      "<h3>" + (n.title || "Antes de instalar") + "</h3>" +
      '<p class="db-notice-lead">' + (n.lead || "") + "</p>" +
      '<p class="db-notice-note">' + (n.note || "") + "</p>" +
      '<ol class="db-steps">' + steps + "</ol>" +
      '<button class="db-btn" id="db-go">' + (n.cta || "Descargar de todos modos") + "</button>" +
      '<button class="db-btn db-ghost" id="db-stop">' + (n.secondary || "Cancelar") + "</button>"
    );
    noticeOpen = true;
    var extra = qs("[data-close]", w);
    if (extra) extra.remove(); // 已经有「Cancelar」，去掉多余按钮
    var close = function () { noticeOpen = false; w.remove(); };
    on(qs(".db-mask", w), "click", close);
    on(qs("#db-stop", w), "click", close);
    on(qs("#db-go", w), "click", function () {
      // 确认下载 = 购买事件
      track(ev.purchase || "Purchase");
      window.location.href = DL;
    });
  }


  /* ---------- 2.7 统一下载入口（先弹安全提示，再跳转） ---------- */
  function bindDownloadLinks() {
    D.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a") : null;
      if (!a) return;
      if (a.closest(".db-steps") || a.id === "db-go") return;
      var href = a.getAttribute("href") || "";
      var isDl = a.hasAttribute("data-dl") || (DL && (href === DL || href.indexOf(DL) === 0));
      if (!isDl) return;
      e.preventDefault();
      e.stopPropagation();
      openDownloadNotice();
    }, true);
  }


  /* ---------- 2.8 应用内浏览器（FB / IG / LINE 等）拦截 ---------- */
  function inAppBrowser() {
    var ua = navigator.userAgent || "";
    // 1) Android WebView 的硬特征：UA 里有 "; wv)" 或 "Version/4.0"（Chrome 自带浏览器没有这两个）
    if (/Android/i.test(ua) && (/; wv\)/i.test(ua) || /Version\/4\.0/i.test(ua))) return true;
    // 2) 明确的国内/日韩内置浏览器
    if (/MicroMessenger|Line\//i.test(ua)) return true;
    // 3) FB / IG 标记 + 非标准 Chrome（Custom Tab 会带完整 Chrome 版本号，能正常下载，不算内置）
    if (/FB_IAB|FBAN\/|FBAV\/|Instagram/i.test(ua) && !/Chrome\/\d+\.\d+\.\d+\.\d+/i.test(ua)) return true;
    return false;
  }

  /* 自检：链接后加 ?dbg=1 会显示判定结果和 UA，方便在真机上确认 */
  function debugInApp() {
    if (!/[?&]dbg=1/.test(location.search)) return;
    var d = D.createElement("div");
    d.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#000;color:#0f0;font:11px/1.4 monospace;padding:8px;border-radius:8px;word-break:break-all";
    d.textContent = "inApp=" + inAppBrowser() + "\n" + navigator.userAgent;
    D.body.appendChild(d);
  }

  function showInAppGuide() {
    if (qs("#db-inapp")) return;
    var g = CFG.inAppGuide || {};
    var steps = g.steps || g.stepsAndroid || [];
    var list = steps.map(function (t, i) {
      return '<li><span class="db-step-n">' + (i + 1) + "</span><span>" + t + "</span></li>";
    }).join("");
    var w = D.createElement("div");
    w.id = "db-inapp";
    w.innerHTML =
      '<div class="db-mask"></div><div class="db-sheet db-inapp-sheet">' +
      "<h3>" + (g.title || "Abre esta página en tu navegador") + "</h3>" +
      '<p class="db-notice-lead">' + (g.body || "") + "</p>" +
      '<ol class="db-steps">' + list + "</ol>" +
      '<button class="db-btn" id="db-inapp-ok">' + (g.cta || "Entendido") + "</button>" +
      "</div>";
    D.body.appendChild(w);
    var done = function () {
      w.remove();
      if ((CFG.inAppGuide || {}).sticky !== false) showInAppBar();
    };
    on(qs(".db-mask", w), "click", done);
    on(qs("#db-inapp-ok", w), "click", done);
  }

  /* ---------- 3. 移动端抽屉菜单 ---------- */
  function buildDrawer() {
    var icon = qs('img[class*="navMenuIcon"]');
    if (!icon || qs("#db-drawer")) return;
    var items = [
      ["Inicio", "/es/"],
      ["Categorías", "/es/browse/"],
      ["App", "/es/download/"],
      ["Más populares", "/es/more/trending/"],
      ["Imprescindibles", "/es/more/must-sees/"],
      ["Joyas ocultas", "/es/more/hidden-gems/"]
    ];
    var wrap = D.createElement("div");
    wrap.id = "db-drawer";
    wrap.innerHTML =
      '<div class="db-mask"></div><nav class="db-panel">' +
      '<div class="db-brand">DramaBox</div>' +
      items.map(function (i) { return '<a href="' + i[1] + '">' + i[0] + "</a>"; }).join("") +
      '<div class="db-legal"><a href="/terms.html">Términos de uso</a><a href="/privacy.html">Privacidad</a></div></nav>';
    D.body.appendChild(wrap);
    on(qs(".db-mask", wrap), "click", function () { wrap.classList.remove("open"); });
    on(icon, "click", function (e) { e.preventDefault(); wrap.classList.add("open"); });
    on(icon.parentElement, "click", function (e) {
      if (e.target === icon || e.target === icon.parentElement) { e.preventDefault(); wrap.classList.add("open"); }
    });
  }

  /* ---------- 4. 搜索 ---------- */
  function bindSearch() {
    qsa('input[class*="navRightInput"], input[type="search"], input[placeholder]').forEach(function (inp) {
      if (inp.dataset.dbSearch) return;
      inp.dataset.dbSearch = "1";
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          var q = (inp.value || "").trim();
          location.href = "/es/search/" + (q ? "?q=" + encodeURIComponent(q) : "");
        }
      });
    });
    qsa('[class*="navRightWapIcon"],[class*="searchIcon"]').forEach(function (el) {
      if (el.dataset.dbSearchBtn) return;
      el.dataset.dbSearchBtn = "1";
      el.addEventListener("click", function () {
        var box = qs('[class*="searchContainer"]');
        if (box) box.classList.toggle("db-search-open");
        var inp = qs('[class*="navRightInput"]');
        if (inp) inp.focus();
      });
    });
  }

  /* ---------- 5. 简介展开 / 列表横向拖动 ---------- */
  function bindMisc() {
    qsa('[class*="expand"]').forEach(function (el) {
      on(el, "click", function () {
        var box = el.closest('[class*="introBox"]');
        if (box) box.classList.toggle("db-expanded");
        el.classList.toggle("db-open");
      });
    });
    qsa('[class*="scrollBox"],[class*="cardList"],[class*="swiper"]').forEach(function (el) {
      if (el.dataset.dbDrag) return;
      el.dataset.dbDrag = "1";
      el.style.overflowX = "auto";
      el.style.webkitOverflowScrolling = "touch";
    });
  }

  /* ---------- 6. 剧集列表：Ver más + 付费墙 ---------- */
  function bookIdFromPath() {
    var m = location.pathname.match(/\/es\/(?:drama|video)\/(\d+)/);
    return m ? m[1] : null;
  }

  function modal(html) {
    var old = qs("#db-modal");
    if (old) old.remove();
    var w = D.createElement("div");
    w.id = "db-modal";
    w.innerHTML = '<div class="db-mask"></div><div class="db-sheet">' + html +
      '<button class="db-btn db-ghost" data-close>Cerrar</button></div>';
    D.body.appendChild(w);
    on(qs(".db-mask", w), "click", function () { w.remove(); });
    on(qs("[data-close]", w), "click", function () { w.remove(); });
    return w;
  }

  function lockedModal(name, ep) {
    var title = PW.title || "Sigue viendo sin límites";
    var body = PW.body || ("Los episodios que faltan están en la app. Descarga " + APP + " y desbloquea la serie completa: sin pagos y sin límites.");
    modal(
      "<h3>" + title + "</h3>" +
      '<p class="db-pw-ep">' + (name ? name + " · " : "") + "Episodio " + ep + "</p>" +
      "<p>" + body + "</p>" +
      '<a class="db-btn" href="' + DL + '" data-dl>' + (PW.cta || "Descargar gratis") + "</a>"
    );
  }

  function bindEpisodeList() {
    var id = bookIdFromPath();
    var more = qs('[class*="viewMore"]');
    if (!id || !more) return;
    on(more, "click", function (e) {
      e.preventDefault();
      if (more.dataset.done) return;
      fetch("/data/books/" + id + ".json").then(function (r) { return r.json(); }).then(function (d) {
        var box = qs('[class*="listInfo"]');
        var tpl = qs('[class*="listItem"]', box);
        if (!box || !tpl) return;
        var slug = (d.bookInfo.bookNameEn || "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
        // 已经渲染出来的集数（SSR 里有几集就跳过几集，避免重复）
        var existing = qsa('[class*="listItem"]', box).filter(function (n) {
          return !n.querySelector('[class*="viewMore"]');
        }).length;
        (d.chapterList || []).forEach(function (c, i) {
          if (i < existing) return;
          var node = tpl.cloneNode(true);
          var href = "/es/video/" + id + "_" + slug + "/" + c.id + "_Episode-" + (c.index + 1);
          qsa("a", node).forEach(function (a) { a.setAttribute("href", href); });
          var pn = qs('[class*="pageNum"]', node);
          if (pn) pn.textContent = "Episodio " + (c.index + 1);
          var img = qs("img", node);
          if (img && c.cover) img.src = c.cover;
          if (!c.unlock) {
            node.style.opacity = ".72";
            node.dataset.locked = "1";
            qs("a", node) && qs("a", node).addEventListener("click", function (ev) {
              ev.preventDefault();
              lockedModal(d.bookInfo.bookName, c.index + 1);
            });
          }
          box.insertBefore(node, more.parentElement === box ? more : null);
        });
        more.dataset.done = "1";
        more.style.display = "none";
      }).catch(function () { });
    });
  }

  /* ---------- 7. 播放页 ---------- */
  function bindPlayer() {
    var box = qs('[class*="videoContainer"]');
    if (!box) return;
    var m = location.pathname.match(/\/es\/video\/(\d+)_([^/]+)(?:\/(\d+)_[^/]+)?/);
    if (!m) return;
    var bookId = m[1];
    var chapterId = m[3] || new URLSearchParams(location.search).get("ep") || "";
    fetch("/data/books/" + bookId + ".json").then(function (r) { return r.json(); }).then(function (d) {
      var list = d.chapterList || [];
      var cur = list.filter(function (c) { return String(c.id) === String(chapterId); })[0] ||
        list.filter(function (c) { return String(c.index + 1) === String(chapterId); })[0] || list[0];
      if (!cur) return;
      // 修正面包屑 / 标题里的集数
      var ep = cur.index + 1;
      var crumb = qs('[class*="lastTxt"]');
      if (crumb) crumb.textContent = "Episodio " + ep;
      qsa('[class*="videoWrap"] *, [class*="videoIntro"] *').forEach(function (el) {
        Array.prototype.slice.call(el.childNodes || []).forEach(function (n) {
          if (n.nodeType === 3 && /Episodio \d+/.test(n.nodeValue)) {
            n.nodeValue = n.nodeValue.replace(/Episodio \d+/g, "Episodio " + ep);
          }
        });
      });
      document.title = document.title.replace(/Episodio \d+/g, "Episodio " + ep);
      markActiveEpisode(ep, (d.chapterList || []).length);
      normalizeImages();
      // 高亮当前集
      qsa('[class*="linkText"]').forEach(function (a) {
        a.classList.toggle(a.className.match(/Active/) ? "x" : "x", false);
      });
      if (!cur.unlock || !cur.mp4) {
        var pwTitle = PW.title || "Sigue viendo sin límites";
        var pwBody = PW.body || ("Los episodios que faltan están en la app. Descarga " + APP + " y desbloquea la serie completa: sin pagos y sin límites.");
        box.innerHTML =
          '<div class="db-lock">' +
          '<div class="db-lock-title">' + pwTitle + "</div>" +
          '<div class="db-lock-sub">Episodio ' + (cur.index + 1) + " · " + pwBody + "</div>" +
          '<a class="db-btn" href="' + DL + '">' + (PW.cta || "Descargar gratis") + "</a>" +
          "</div>";
        return;
      }
      var v = D.createElement("video");
      // 走同源 /video/<bookId>/<chapterId>.mp4：由 Pages Function 校验签名、必要时回源重签
      // （原站直链只有 24 小时有效期，直接热链会隔天失效）
      v.src = "/video/" + bookId + "/" + cur.id + ".mp4";
      var triedDirect = false;
      v.addEventListener("error", function () {
        if (triedDirect || !cur.mp4) return;
        triedDirect = true;
        v.src = cur.mp4; // 兜底：直连原站签名地址
        v.load();
        v.play().catch(function () { });
      });
      v.controls = true;
      v.autoplay = true;
      v.playsInline = true;
      v.setAttribute("playsinline", "");
      v.setAttribute("webkit-playsinline", "");
      v.preload = "auto";
      v.poster = cur.cover || "";
      v.className = "db-video";
      box.appendChild(v);
      // 自动播放：先尝试带声音，被浏览器拦截则静音播放（用户可点开音量）
      var p = v.play();
      if (p && p.catch) {
        p.catch(function () {
          v.muted = true;
          v.play().catch(function () { });
        });
      }
      // 播放结束后自动下一集
      v.addEventListener("ended", function () {
        var next = list[cur.index + 1];
        if (!next) return;
        var slug = location.pathname.split("/")[3];
        location.href = "/es/video/" + slug + "/" + next.id + "_Episode-" + (next.index + 1);
      });
    }).catch(function () { });
  }



  /* ---------- 7.05 当前集高亮（桌面侧栏 + 底部抽屉） ---------- */
  function markActiveEpisode(ep, total) {
    var links = qsa('[class*="linkText"]');
    var activeCls = null;
    links.forEach(function (a) {
      var m = (a.className || "").match(/\S*linkTextActive\S*/);
      if (m) activeCls = m[0];
    });
    if (activeCls) {
      links.forEach(function (a) {
        var base = (a.className || "").replace(new RegExp("\\s*" + activeCls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*", "g"), " ").trim();
        var isCur = (a.textContent || "").trim() === String(ep);
        a.className = base + (isCur ? " " + activeCls : "");
      });
    }
    // 移动端集数格子（epiOuter / epiItemActive）
    var epi = qsa('[class*="epiOuter"]');
    var epiActive = null;
    epi.forEach(function (e) {
      var m = (e.className || "").match(/\S*epiItemActive\S*/);
      if (m) epiActive = m[0];
    });
    if (epiActive) {
      epi.forEach(function (e) {
        var base = (e.className || "").replace(new RegExp("\\s*" + epiActive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*", "g"), " ").trim();
        var isCur = (e.textContent || "").trim() === String(ep);
        e.className = base + (isCur ? " " + epiActive : "");
      });
    }

    var cur = qs('[class*="rightTop"] [class*="current"]');
    if (cur) cur.textContent = "(" + ep + "/" + (total || "") + ")";
    qsa('.db-ep').forEach(function (a) {
      a.classList.toggle("active", (a.textContent || "").trim() === String(ep));
    });
  }

  /* ---------- 7.1 底部「Episodios」抽屉 ---------- */
  function bindEpisodesSheet() {
    var nav = qs('[class*="EpisodeNav"]');
    if (!nav) return;
    var items = qsa("div", nav).filter(function (d) { return /Episodios/.test(d.textContent || "") && d.children.length < 3; });
    var target = items[0];
    if (!target) return;
    target.style.cursor = "pointer";
    target.addEventListener("click", function (e) {
      e.preventDefault();
      var m = location.pathname.match(/\/es\/video\/(\d+_[^/]+)/);
      if (!m) return;
      var bslug = m[1], bid = bslug.split("_")[0];
      fetch("/data/books/" + bid + ".json").then(function (r) { return r.json(); }).then(function (d) {
        var list = (d.chapterList || []).map(function (c) {
          var href = "/es/video/" + bslug + "/" + c.id + "_Episode-" + (c.index + 1);
          return '<a class="db-ep' + (c.unlock ? "" : " locked") + '" href="' + href + '">' + (c.index + 1) + "</a>";
        }).join("");
        var w = modal('<h3>Episodios</h3><div class="db-eps">' + list + "</div>");
      }).catch(function () { });
    });
  }


  /* ---------- 7.2 详情页底部导航（Reproducir / Descargar） ---------- */
  function bindDetailBottomNav() {
    if (!/\/es\/drama\//.test(location.pathname)) return;
    var nav = qs('[class*="EpisodeNav"]');
    if (!nav) return;
    qsa("a,div", nav).forEach(function (el) {
      var t = (el.textContent || "").trim();
      if (el.dataset.dbNav) return;
      if (t === "Reproducir") {
        el.dataset.dbNav = "1";
        el.style.cursor = "pointer";
        el.addEventListener("click", function (e) {
          e.preventDefault();
          var first = qs('a[href*="/es/video/"]');
          if (first) location.href = first.getAttribute("href");
        });
      } else if (t === "Descargar") {
        el.dataset.dbNav = "1";
        el.style.cursor = "pointer";
        el.addEventListener("click", function (e) {
          e.preventDefault();
          openDownloadNotice();
        });
      }
    });
  }

  /* ---------- 8. 搜索页 ---------- */
  function bindSearchPage() {
    var host = qs("#db-results");
    if (!host) return;
    var q = (new URLSearchParams(location.search).get("q") || "").trim();
    var inp = qs("#db-q");
    if (inp) inp.value = q;
    fetch("/data/index.json").then(function (r) { return r.json(); }).then(function (d) {
      var list = d.books || [];
      var k = q.toLowerCase();
      var hits = k ? list.filter(function (b) {
        return (b.name || "").toLowerCase().indexOf(k) >= 0 ||
          (b.introduction || "").toLowerCase().indexOf(k) >= 0;
      }) : list;
      host.innerHTML = hits.slice(0, 120).map(function (b) {
        return '<a class="db-card" href="/es/drama/' + b.bookId + "/" + (b.slug || "") + '/">' +
          '<img loading="lazy" src="' + (b.cover || "") + '" alt="">' +
          '<span class="db-card-t">' + (b.name || "") + "</span>" +
          '<span class="db-card-s">' + (b.chapterCount || "") + " Episodios</span></a>";
      }).join("") || '<p class="db-empty">Sin resultados</p>';
    }).catch(function () { host.innerHTML = '<p class="db-empty">Sin resultados</p>'; });
  }

  function boot() {
    applyBrand();
    initPixel();
    bindDownloadLinks();
    debugInApp();
    var G = CFG.inAppGuide || {};
    if (inAppBrowser() && G.guideLanding && location.pathname.indexOf("/guia") !== 0) {
      var skip = false;
      try { skip = sessionStorage.getItem("db_guide_skip") === "1"; } catch (e) {}
      if (!skip) { location.replace("/guia/"); return; }
    }
    if (inAppBrowser() && G.auto === true) showInAppGuide();
    buildDrawer();
    hydrateLazy();
    normalizeImages();
    bindSearch();
    bindMisc();
    bindEpisodeList();
    bindPlayer();
    bindEpisodesSheet();
    bindDetailBottomNav();
    bindSearchPage();
  }
  /* 先加载 /config.js（站点配置），失败也不阻塞，用内置默认值 */
  function start() {
    if (window.DBX) { hydrateCfg(); return boot(); }
    var s = D.createElement("script");
    s.src = "/config.js";
    s.onload = function () { hydrateCfg(); boot(); };
    s.onerror = function () { hydrateCfg(); boot(); };
    D.head.appendChild(s);
  }

  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", start);
  else start();
})();
