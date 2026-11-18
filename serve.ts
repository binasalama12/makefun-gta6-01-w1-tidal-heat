import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const gameDirectory = resolve('game');
const address = '127.0.0.1';
const port = 8917;
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.json', 'application/json; charset=utf-8'],
]);

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' });
    response.end('method not allowed');
    return;
  }

  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', `http://${address}:${port}`).pathname);
    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = resolve(join(gameDirectory, relativePath));
    if (filePath !== gameDirectory && !filePath.startsWith(`${gameDirectory}${sep}`)) {
      throw new Error('path outside game directory');
    }

    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(filePath);
    response.writeHead(200, {
      'content-type': contentTypes.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  }
});

server.listen(port, address, () => {
  console.log(`TIDAL HEAT available at http://${address}:${port}`);
});
