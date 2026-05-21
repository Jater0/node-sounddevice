#!/usr/bin/env node
/**
 * copy-native-to-dist.js — copy the native addon from source to dist/.
 *
 * Called by: npm run build (after tsc)
 * Ensures dist/ has a copy of index.node and PortAudio DLL.
 */

const fs = require('fs');
const path = require('path');

const nativeDir = path.join(__dirname, '..', 'backends', 'portaudio', 'native');
const distDir = path.join(__dirname, '..', 'dist', 'backends', 'portaudio', 'native');

const indexNode = path.join(nativeDir, 'index.node');
if (!fs.existsSync(indexNode)) {
  console.warn('Warning: index.node not found at', indexNode);
  console.warn('  Run "npm run build:native" first.');
  process.exit(0);
}

// Ensure dist directory exists
fs.mkdirSync(distDir, { recursive: true });

// Copy index.node
fs.copyFileSync(indexNode, path.join(distDir, 'index.node'));
console.log('Copied index.node -> dist/backends/portaudio/native/');

// Copy PortAudio DLL if present
const dlls = fs.readdirSync(nativeDir).filter(f =>
  f.endsWith('.dll') && f.includes('portaudio') && f !== 'index.node'
);
for (const dll of dlls) {
  fs.copyFileSync(path.join(nativeDir, dll), path.join(distDir, dll));
  console.log(`Copied ${dll} -> dist/backends/portaudio/native/`);
}
