/* ===================================================================
 * Dranabox 复刻版 · 站点配置
 * 改这个文件就能换 App 名字 / 下载地址 / 付费墙文案，改完重新构建即可。
 * =================================================================== */
window.DBX = {
  /* App 名字（西语）。全站正文、标题、meta 里的 "DramaBox" 都会替换成它 */
  appName: "DramaBox Ilimitado",

  /* 下载地址：APK / Play 商店 / 落地页都行，点击所有下载按钮都会跳这里 */
  downloadUrl: "https://www.dramabox.com/es/download/",

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
  }
};
