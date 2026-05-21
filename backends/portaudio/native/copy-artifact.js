#!/usr/bin/env node
/**
 * copy-artifact.js — copy napi-rs build output to the expected locations.
 *
 * Copies the compiled .node addon and PortAudio runtime DLL to:
 *   1. The native source directory (for tsx dev server)
 *   2. The dist/ directory (for compiled distribution)
 *
 * Called by: cargo build && node copy-artifact.js
 */

const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, 'target');
const nativeDir = __dirname; // backends/portaudio/native/
const distDir = path.join(__dirname, '..', '..', '..', 'dist', 'backends', 'portaudio', 'native');

// Find the built .node file
const releaseDir = path.join(targetDir, 'release');
const debugDir = path.join(targetDir, 'debug');
const buildDir = fs.existsSync(releaseDir) ? releaseDir : debugDir;

const files = fs.readdirSync(buildDir);
const addonFile = files.find(f => f.endsWith('.dll') && f.startsWith('node_sounddevice_native'))
  || files.find(f => f.endsWith('.so') && f.startsWith('libnode_sounddevice_native'))
  || files.find(f => f.endsWith('.dylib') && f.startsWith('libnode_sounddevice_native'));

if (!addonFile) {
  console.error('Error: Could not find built addon in', buildDir);
  console.error('Files:', files.join(', '));
  process.exit(1);
}

const src = path.join(buildDir, addonFile);

// Copy to source directory (for tsx development)
const srcDest = path.join(nativeDir, 'index.node');
fs.copyFileSync(src, srcDest);
console.log(`Copied ${addonFile} -> ${path.relative(process.cwd(), srcDest)}`);

// Copy to dist directory (for compiled distribution)
if (fs.existsSync(path.dirname(distDir))) {
  fs.mkdirSync(distDir, { recursive: true });
  const distDest = path.join(distDir, 'index.node');
  fs.copyFileSync(src, distDest);
  console.log(`Copied ${addonFile} -> ${path.relative(process.cwd(), distDest)}`);
}

// Copy the PortAudio DLL next to both destinations (Windows runtime dependency)
const paDll = files.find(f => f.includes('portaudio') && f.endsWith('.dll'));
if (paDll) {
  const paSrc = path.join(buildDir, paDll);

  const paSrcDest = path.join(nativeDir, paDll);
  fs.copyFileSync(paSrc, paSrcDest);

  if (fs.existsSync(path.dirname(distDir))) {
    const paDistDest = path.join(distDir, paDll);
    fs.copyFileSync(paSrc, paDistDest);
  }
  console.log(`Copied ${paDll} (runtime dependency)`);
}
