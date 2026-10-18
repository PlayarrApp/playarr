// Real LG TV screenshot over the web inspector (app only: no system menus, keyboard or video plane).
//   ares-inspect --device lg-real com.playarr.tv   (prints the DevTools port, e.g. 35881)
//   node real-tv-shot.mjs <port> <out.png>
import { writeFileSync } from "node:fs";
const [port, out] = process.argv.slice(2);
if (!port || !out) throw new Error("usage: real-tv-shot.mjs <port> <out.png>");
const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id !== 1) return;
  writeFileSync(out, Buffer.from(msg.result.data, "base64"));
  process.exit(0);
};
ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png", fromSurface: true } }));
