// 試し見用の小さなサーバー（このパソコンの中だけ。置き場には入れない）
// node tools/serve.mjs → http://localhost:5181/   （資材便の 5180 とぶつからないように 5181）
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT) || 5181;
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (p.endsWith("/")) p += "index.html";
    if (p.split("/").some(part => part.startsWith("."))) throw new Error("hidden");
    const file = resolve(join(root, normalize(p)));
    if (!file.startsWith(root + sep)) throw new Error("outside");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch (err) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("ありません");
  }
}).listen(port, "localhost", () => console.log(`http://localhost:${port}/`));
