/**
 * record.ts — 录制音频到文件
 *
 * 对应 python-sounddevice/examples/rec_unlimited.py
 *
 * 用法：
 *   npx ts-node examples/record.ts [duration_seconds] [output.wav]
 */

import * as fs from 'fs';
import { getBackend } from '../src/index';

/** 写入 WAV 文件头 */
function writeWavHeader(
  fd: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
  dataSize: number,
): void {
  const buf = Buffer.alloc(44);
  // RIFF
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  // fmt
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // chunk size
  buf.writeUInt16LE(1, 20);  // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  buf.writeUInt16LE(channels * bitsPerSample / 8, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  // data
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  fs.writeSync(fd, buf);
}

/** 更新 WAV 头中的 data 大小 */
function updateWavHeader(fd: number, dataSize: number): void {
  // RIFF 总大小
  fs.writeSync(fd, Buffer.alloc(4), 0, 4, 4);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(36 + dataSize, 0);
  fs.writeSync(fd, riffSize, 0, 4, 4);
  // data 大小
  fs.writeSync(fd, Buffer.alloc(4), 0, 4, 40);
  const dataSizeBuf = Buffer.alloc(4);
  dataSizeBuf.writeUInt32LE(dataSize, 0);
  fs.writeSync(fd, dataSizeBuf, 0, 4, 40);
}

async function main() {
  const duration = parseFloat(process.argv[2] ?? '5');
  const outFile = process.argv[3] ?? 'recording.wav';
  const sampleRate = 48000;
  const channels = 1;

  console.log(`Recording ${duration}s at ${sampleRate} Hz to ${outFile}...`);
  console.log('Press Ctrl+C to stop early.');

  const frames = Math.ceil(duration * sampleRate);
  const backend = await getBackend();

  // 打开输出文件（先写占位头）
  const fd = fs.openSync(outFile, 'w');
  writeWavHeader(fd, sampleRate, channels, 16, 0);

  const stream = backend.openStream(
    'input',
    { sampleRate, channels, dtype: 'float32', blockSize: 0 },
  );

  stream.start();

  const blockSize = 1024;
  let totalFrames = 0;
  const startTime = Date.now();

  while (totalFrames < frames) {
    if (Date.now() - startTime > duration * 1000) break;

    const block = stream.read(blockSize);
    // 转换为 int16 写入 WAV
    const int16Buf = Buffer.alloc(block.length * 2);
    for (let i = 0; i < block.length; i++) {
      const sample = Math.max(-1, Math.min(1, block[i]!));
      int16Buf.writeInt16LE(Math.round(sample * 32767), i * 2);
    }
    fs.writeSync(fd, int16Buf);
    totalFrames += blockSize;

    // 进度
    const elapsed = (Date.now() - startTime) / 1000;
    process.stdout.write(`\rRecording... ${elapsed.toFixed(1)}s / ${duration}s`);
  }

  stream.stop();
  stream.close();

  // 更新 WAV 头
  const dataSize = totalFrames * channels * 2;
  updateWavHeader(fd, dataSize);
  fs.closeSync(fd);

  console.log(`\nDone! Written ${totalFrames} frames to ${outFile}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
