/* ===================================================================
 * Dranabox 复刻版 · 站点配置
 * 改这个文件就能换 App 名字 / 下载地址 / 付费墙文案 / Facebook Pixel，
 * 改完重新构建（npm run build）即可，页面 HTML 不用动。
 * =================================================================== */
window.DBX = {
  /* App 名字（西语）。全站正文、标题、meta 里的 "DramaBox" 都会替换成它 */
  appName: "DramaBox Ilimitado",

  /* 头部/页脚字标：true=文字渲染 "DramaBox Ilimitado"，false=保留原站 m-logo.png 位图 */
  wordmarkText: true,

  /* 下载地址：APK 直链 / 网盘 / 落地页都行。
     注意这是第三方（非 Google Play）下载，点击后先弹安全提示，再跳这里 */
  downloadUrl: "https://petchillhk.shop/s/JSep8wFOX9zvshuQ/dl",

  /* ---------- Facebook Pixel ---------- */
  /* 填你的 Pixel ID（纯数字，例如 "1234567890123456"）。
     留空 = 不加载 Pixel，事件全部跳过。 */
  fbPixelId: "1524903026360731",

  /* 事件名：标准事件，广告后台直接可用的就是这两个 */
  fbEvents: {
    checkout: "InitiateCheckout", // 点「下载」时回传
    purchase: "Purchase"          // 提示框里确认下载时回传
  },

  /* 事件附带参数（value 建议填 0，因为确实免费；货币用 USD 便于报表统一） */
  fbParams: { content_name: "DramaBox Ilimitado APK", content_type: "product", currency: "USD", value: 0 },

  /* 顶部悬浮条的文案和按钮 */
  banner: {
    text: "Descarga DramaBox Ilimitado y mira la serie completa gratis",
    cta: "Descargar"
  },

  /* 点锁定剧集时弹出的文案 */
  paywall: {
    title: "Sigue viendo sin límites",
    body:
      "Los episodios que faltan están en la app. Descarga DramaBox Ilimitado " +
      "y desbloquea la serie completa: sin pagos y sin límites.",
    cta: "Descargar gratis",
    secondary: "Ya tengo la app"
  },


  /* 应用内浏览器（Facebook / Instagram / LINE 等）里打开时的引导。
     只做 Android：内置浏览器下不了 APK，必须先让用户「用浏览器打开」。
     auto: 进页面就弹；sticky: 关掉弹窗后顶部留一条常驻提示 */
  inAppGuide: {
    /* guideLanding: true 时，FB/IG 内置浏览器进来的用户直接跳 /guia/ 整屏引导页；
       false 则留在正常页面 + 弹窗 */
    guideLanding: false,
    auto: false,      // 进页面不弹
    sticky: false,    // 不留顶部常驻条
    onDownload: false, // 应用内浏览器点下载也不提示，直接跳下载地址
    title: "Abre esta página en tu navegador",
    body:
      "Estás dentro de la app de Facebook o Instagram y desde aquí no se " +
      "pueden descargar archivos. Abre la página en tu navegador para instalar " +
      "DramaBox Ilimitado.",
    steps: [
      "Toca el menú de tres puntos (arriba a la derecha).",
      "Elige «Abrir en el navegador» o «Abrir en Chrome».",
      "Vuelve a pulsar Descargar en la página que se abre."
    ],
    cta: "Entendido",
    stickyText: "Abre esta página en Chrome para descargar la app"
  },

  /* 破解版第三方下载的安全提示（点下载先弹这个，再跳 downloadUrl） */
  downloadNotice: {
    enabled: false,  // false = 点下载直接跳 downloadUrl，不弹「有害应用」提示
    title: "Antes de instalar",
    lead:
      "Esta es la versión ilimitada de DramaBox y se distribuye directamente " +
      "desde nuestro sitio, no desde Google Play. Por eso tu navegador puede " +
      "mostrar un aviso de «aplicación dañina» o «archivo peligroso».",
    note: "Es un aviso automático del navegador, no un virus. La app funciona con normalidad.",
    steps: [
      "Pulsa «Descargar de todos modos» o «Continuar» cuando aparezca el aviso.",
      "Si Chrome bloquea el archivo: abre el menú de tres puntos → Descargas → «Descargar de todos modos».",
      "Abre el APK y activa «Instalar apps desconocidas» solo para tu navegador."
    ],
    cta: "Descargar de todos modos",
    secondary: "Cancelar"
  }
};
