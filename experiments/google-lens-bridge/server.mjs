import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('./index.html', import.meta.url));
const replyScript = await readFile(new URL('./reply.mjs', import.meta.url));
const arg = process.argv.indexOf('--port');
const port = Number(process.env.PORT || (arg >= 0 ? process.argv[arg + 1] : 3000));
createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const asset = path === '/' ? html : path === '/reply.mjs' ? replyScript : null;
  if (!asset) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': path === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(asset);
}).listen(port, '0.0.0.0', () => console.log(`Lens bridge experiment listening on ${port}`));
