#!/usr/bin/env node
/**
 * copy-native-to-dist.js — copy the native addon from source to dist/.
 *
 * Called by: npm run build (after tsc)
 */

const fs = require('fs');
const path = require('path');

const nativeDir = path.join(__dirname, '..', 'backends', 'portaudio', 'native');
const distDir = path.join(__dirname, '..', 'dist', 'backends', 'portaudio', 'native');

const indexNode = path.join(nativeDir, 'index.node');
if (!fs.existsSync(indexNode)) {
  console.warn('Warning: index.node not found. Run "npm run build:native" first.');
  process.exit(0);
}

fs.mkdirSync(distDir, { recursive: true });
fs.copyFileSync(indexNode, path.join(distDir, 'index.node'));
console.log('Copied index.node -> dist/backends/portaudio/native/');

// Copy PortAudio runtime files (DLL/dylib/so), keep original names
const runtimeFiles = fs.readdirSync(nativeDir, { withFileTypes: true })
  .filter(d => d.isFile())
  .map(d => d.name)
  .filter(f =>
    (f.includes('portaudio') || f.endsWith('.dylib') || f.endsWith('.so')) &&
    f !== 'index.node'
  );
for (const f of runtimeFiles) {
  fs.copyFileSync(path.join(nativeDir, f), path.join(distDir, f));
  console.log(`Copied ${f} -> dist/backends/portaudio/native/`);
}
