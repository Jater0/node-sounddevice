/**
 * play_file.ts — 播放 WAV 文件
 *
 * 对应 python-sounddevice/examples/play_file.py
 *
 * 用法：
 *   npx ts-node examples/play_file.ts <file.wav>
 */

import * as fs from 'fs';
import { getBackend } from '../src/index';

/** 简易 WAV 解析器（仅支持 PCM 16-bit mono/stereo） */
function parseWav(filepath: string): {
  data: Float32Array;
  sampleRate: number;
  channels: number;
} {
  const buf = fs.readFileSync(filepath);
  // RIFF header
  if (buf.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Not a valid WAV file (missing RIFF header)');
  }

  // fmt 子块
  const audioFormat = buf.readUInt16LE(20);
  if (audioFormat !== 1) {
    throw new Error(`Unsupported audio format: ${audioFormat} (only PCM=1 supported)`);
  }

  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);

  if (bitsPerSample !== 16) {
    throw new Error(`Unsupported bit depth: ${bitsPerSample} (only 16-bit supported in this example)`);
  }

  // data 子块 (跳过前 44 字节 WAV 头，找到 "data" 块)
  let offset = 36;
  while (offset < buf.length - 8) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      const samples = chunkSize / 2;
      const data = new Float32Array(samples);
      for (let i = 0; i < samples; i++) {
        data[i] = buf.readInt16LE(offset + 8 + i * 2) / 32768;
      }
      return { data, sampleRate, channels };
    }
    offset += 8 + chunkSize;
  }

  throw new Error('No data chunk found in WAV file');
}

async function main() {
  const filepath = process.argv[2];
  if (!filepath) {
    console.error('Usage: npx ts-node examples/play_file.ts <file.wav>');
    process.exit(1);
  }

  console.log(`Loading ${filepath}...`);
  const { data, sampleRate, channels } = parseWav(filepath);
  console.log(
    `Sample rate: ${sampleRate} Hz, Channels: ${channels}, ` +
    `Duration: ${(data.length / channels / sampleRate).toFixed(2)}s`,
  );

  const backend = await getBackend();

  const stream = backend.openStream(
    'output',
    {
      sampleRate,
      channels,
      dtype: 'float32',
      blockSize: 0,
    },
    // 回调模式：按需推送数据
    (indata, outdata, frames, time, status) => {
      // 阻塞模式更简单 — 直接 write
      // 这里展示回调模式
    },
  );

  // 使用阻塞模式播放
  stream.start();

  const blockSize = 1024;
  let offset = 0;

  while (offset < data.length) {
    const frames = Math.min(blockSize, (data.length - offset) / channels);
    const block = data.slice(offset * channels, (offset + frames) * channels);
    stream.write(new Float32Array(block));
    offset += frames;
  }

  stream.stop();
  stream.close();
  console.log('Playback finished.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
