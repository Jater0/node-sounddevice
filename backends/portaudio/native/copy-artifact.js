#!/usr/bin/env node
/**
 * copy-artifact.js — copy napi-rs build output to the expected locations.
 *
 * Copies the compiled .node addon and PortAudio runtime DLL to:
 *   1. The native source directory (for tsx dev server)
 *   2. The dist/ directory (for compiled distribution)
 */

const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, 'target');
const nativeDir = __dirname;
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
  process.exit(1);
}

const src = path.join(buildDir, addonFile);

function copyToDir(destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  // Copy addon as index.node
  fs.copyFileSync(src, path.join(destDir, 'index.node'));
  // Copy PortAudio runtime libraries (DLL/dylib/so), keep original names
  const paFiles = files.filter(f =>
    (f.includes('portaudio') || f.endsWith('.dylib') || f.endsWith('.so')) &&
    f !== addonFile &&
    !f.endsWith('.exp') &&
    !f.endsWith('.lib') &&
    !f.endsWith('.pdb')
  );
  for (const pa of paFiles) {
    fs.copyFileSync(path.join(buildDir, pa), path.join(destDir, pa));
  }
  return paFiles;
}

// Copy to source directory
const pas1 = copyToDir(nativeDir);
console.log(`Copied ${addonFile} -> index.node (native/)`);
if (pas1.length) console.log(`Copied runtime: ${pas1.join(', ')}`);

// Copy to dist directory
const pas2 = copyToDir(distDir);
console.log(`Copied ${addonFile} -> index.node (dist/)`);
if (pas2.length) console.log(`Copied runtime: ${pas2.join(', ')}`);
