// Tiny static file server for local testing of the entry (Node 22, stdlib only).
//   node serve.ts [port]        (default 8080)
// Then open http://localhost:8080/game/index.html
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.argv[2] || 8080);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.md': 'text/plain' };

createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = join(here, url === '/' ? 'game/index.html' : url);
  if (!file.startsWith(here) || !existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`serving ${here} at http://localhost:${port}/game/index.html`));
