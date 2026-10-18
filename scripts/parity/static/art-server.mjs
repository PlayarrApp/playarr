#!/usr/bin/env node
// Serves the generated artwork files on loopback for the backend's artwork cache. Usage: art-server.mjs <art-dir> <port>
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const [dir, port] = process.argv.slice(2);
if (!dir || !port) throw new Error("usage: art-server.mjs <art-dir> <port>");
createServer(async (req, res) => {
  const name = basename(new URL(req.url, "http://x").pathname); // basename: no path traversal out of dir
  const body = /^[0-9a-f-]+-(poster|backdrop)\.png$/.test(name) ? await readFile(join(dir, name)).catch(() => null) : null;
  res.writeHead(body ? 200 : 404, { "content-type": "image/png" });
  res.end(body ?? undefined);
}).listen(Number(port), "127.0.0.1");
