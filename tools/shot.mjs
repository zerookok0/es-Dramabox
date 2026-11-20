// CDP screenshot + DOM metrics helper (Node 22+, zero deps).
// usage: node tools/shot.mjs <url> <outPng> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const [, , url, out, w = "390", h = "844"] = process.argv;
const PORT = 9333;
const tmp = path.join(process.env.TEMP || ".", "edge-cdp-" + Date.now());

const proc = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
  "--no-default-browser-check", `--user-data-dir=${tmp}`,
  `--remote-debugging-port=${PORT}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(p) {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`);
  return r.json();
}

async function main() {
  let target = null;
  for (let i = 0; i < 40; i++) {
    try {
      await json("/json/version");
      break;
    } catch { await sleep(250); }
  }
  const list = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(list.webSocketDebuggerUrl);
  await new Promise((res) => ws.addEventListener("open", res));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: +w, height: +h, deviceScaleFactor: 2, mobile: true,
  });
  await send("Emulation.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  });
  await send("Page.navigate", { url });
  await sleep(3500);

  const metrics = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      scrollH: document.documentElement.scrollHeight,
      fontRoot: getComputedStyle(document.documentElement).fontSize,
      bodyW: document.body.getBoundingClientRect().width,
      widest: (() => { let w=0,el=null; document.querySelectorAll('*').forEach(n=>{const r=n.getBoundingClientRect(); if(r.width>w){w=r.width;el=n.tagName+'.'+(n.className||'').toString().slice(0,60)}}); return [Math.round(w), el]; })(),
      imgs: document.images.length,
      brokenImgs: [...document.images].filter(i=>i.complete&&i.naturalWidth===0).length,
      title: document.title
    })`,
    returnByValue: true,
  });
  console.log(metrics.result?.result?.value || "{}");
  if (process.env.EVAL) {
    const r = await send("Runtime.evaluate", { expression: process.env.EVAL, returnByValue: true, awaitPromise: true });
    console.log("EVAL:", JSON.stringify(r.result?.result?.value ?? r.result, null, 1).slice(0, 4000));
  }

  const full = +(process.env.FULL || 1);
  let clip;
  if (full) {
    const m = JSON.parse(metrics.result.result.value || "{}");
    clip = { x: 0, y: 0, width: +w, height: Math.min(m.scrollH || +h, 4000), scale: 1 };
  }
  const shot = await send("Page.captureScreenshot", {
    format: "png", captureBeyon