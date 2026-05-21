#!/usr/bin/env node
/**
 * copy-artifact.js — copy napi-rs build output to the expected location.
 *
 * Called by: cargo build && node copy-artifact.js
 * Or: npm run build (from backends/portaudio/native/)
 */

const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, 'target');
const destDir = __dirname; // backends/portaudio/native/

// Find the built .node file (actually a .dll on Windows)
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
const dest = path.join(destDir, 'index.node');

fs.copyFileSync(src, dest);
console.log(`Copied ${addonFile} -> index.node`);

// Also copy the PortAudio DLL next to the .node file (Windows runtime dependency)
const paDll = files.find(f => f.includes('portaudio') && f.endsWith('.dll'));
if (paDll) {
  const paSrc = path.join(buildDir, paDll);
  const paDest = path.join(destDir, paDll);
  fs.copyFileSync(paSrc, paDest);
  console.log(`Copied ${paDll} (runtime dependency)`);
}
