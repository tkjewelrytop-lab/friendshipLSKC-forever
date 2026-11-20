import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const base = process.env.BASE_PATH ? `/${process.env.BASE_PATH.replace(/^\/+|\/+$/g, '')}` : '';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
};

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');

const insideRoot = (target) => target === root || target.startsWith(`${root}${path.sep}`);
const reply = (response, code, body) => {
  response.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(body);
};

const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return reply(response, 405, 'Method not allowed');
  }
  try {
    // Decode before checking segments so encoded traversal is rejected as well.
    const rawPath = (request.url || '/').split(/[?#]/, 1)[0];
    const decoded = decodeURIComponent(rawPath);
    if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) {
      return reply(response, 400, 'Invalid path');
    }
    if (base && decoded === base) {
      response.writeHead(302, { Location: `${base}/` });
      return response.end();
    }
    if (base && !decoded.startsWith(`${base}/`)) return reply(response, 404, 'Not found');
    const relative = decoded.slice(base.length).replace(/^\/+/, '');
    let target = path.resolve(root, relative || 'index.html');
    if (!insideRoot(target)) return reply(response, 403, 'Forbidden');
    let info = await stat(target);
    if (info.isDirectory()) {
      target = path.join(target, 'index.html');
      info = await stat(target);
    }
    target = await realpath(target);
    if (!insideRoot(target) || !info.isFile()) return reply(response, 403, 'Forbidden');
    response.writeHead(200, {
      'Content-Type': mime[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') return response.end();
    const stream = createReadStream(target);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  } catch (error) {
    if (error instanceof URIError) return reply(response, 400, 'Invalid URL');
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return reply(response, 404, 'Not found');
    console.error(error.message);
    reply(response, 500, 'Unable to serve this file');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`The Good Years is ready at http://localhost:${port}${base}/`);
});
server.on('error', (error) => {
  console.error(`Preview could not start: ${error.message}`);
  process.exitCode = 1;
});
