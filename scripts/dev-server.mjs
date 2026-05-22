#!/usr/bin/env node
/**
 * dev-server.mjs — Simple server with COOP/COEP headers for SharedArrayBuffer.
 *
 * Usage: node dev-server.mjs [port]
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const port = parseInt(process.argv[2] || '8080', 10);

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let filePath = path.join(root, req.url === '/' ? 'examples/web_demo.html' : req.url.replace(/^\/+/, ''));

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  // Required for SharedArrayBuffer
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`\n  🌐 http://localhost:${port}/examples/web_demo.html\n`);
  console.log('  COOP/COEP headers enabled for SharedArrayBuffer.');
  console.log('  Press Ctrl+C to stop.\n');
});
