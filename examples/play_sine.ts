/**
 * play_sine.ts — 播放正弦波
 *
 * 对应 python-sounddevice/examples/play_sine.py
 *
 * 用法：
 *   npx ts-node examples/play_sine.ts [frequency] [--device <id>] [--amplitude <amp>]
 */

import { getDevices, getBackend } from '../src/index';
import { defaults } from '../src/defaults';

async function main() {
  const args = process.argv.slice(2);

  // --list-devices
  if (args.includes('--list-devices') || args.includes('-l')) {
    const backend = await getBackend();
    const devices = await getDevices();
    const defIn = backend.devices.getDefaultInputDevice();
    const defOut = backend.devices.getDefaultOutputDevice();
    console.log('Available audio devices:');
    devices.forEach((d, i) => {
      const mark = i === defIn && i === defOut ? '*' : i === defIn ? '>' : i === defOut ? '<' : ' ';
      console.log(
        `${mark} ${String(i).padStart(2)} ${d.name}, ` +
        `(${d.maxInputChannels} in, ${d.maxOutputChannels} out)` +
        ` [${d.defaultSampleRate} Hz]`,
      );
    });
    return;
  }

  // 解析参数
  let frequency = 500;
  let amplitude = 0.2;
  let device: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-d' || args[i] === '--device') {
      device = parseInt(args[++i]!, 10);
    } else if (args[i] === '-a' || args[i] === '--amplitude') {
      amplitude = parseFloat(args[++i]!);
    } else if (!isNaN(parseFloat(args[i]!))) {
      frequency = parseFloat(args[i]!);
    }
  }

  const backend = await getBackend();
  const samplerate = defaults.sampleRate
    ?? (device != null
      ? backend.devices.getDevices().find(d => d.id === device)?.defaultSampleRate
      : backend.devices.getDevices().find(
          d => d.id === backend.devices.getDefaultOutputDevice(),
        )?.defaultSampleRate)
    ?? 48000;

  console.log(`Playing ${frequency} Hz sine wave at ${samplerate} Hz...`);
  console.log('Press Ctrl+C to stop.');

  let startIdx = 0;

  const stream = backend.openStream(
    'output',
    {
      device,
      channels: 1,
      sampleRate: samplerate,
      dtype: 'float32',
    },
    (indata, outdata, frames, time, status) => {
      if (status) {
        console.error('Status flags:', status);
      }
      if (!outdata) return;

      for (let f = 0; f < frames; f++) {
        const t = (startIdx + f) / samplerate;
        outdata[f] = amplitude * Math.sin(2 * Math.PI * frequency * t);
      }
      startIdx += frames;
    },
  );

  stream.start();

  console.log('─'.repeat(40));
  console.log('press Ctrl+C to quit');
  console.log('─'.repeat(40));

  // 保持运行直到 Ctrl+C
  process.on('SIGINT', () => {
    console.log('\nStopping...');
    stream.stop();
    stream.close();
    process.exit(0);
  });

  // 保持事件循环活跃
  await new Promise(() => {});
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
