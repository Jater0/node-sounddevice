/**
 * list_devices.ts — 列出音频设备
 *
 * 对应 python-sounddevice 的 `python -m sounddevice`
 *
 * 用法：
 *   npx ts-node examples/list_devices.ts
 */

import { getDevices, getHostAPIs, getVersionText, getBackend } from '../src/index';

async function main() {
  const backend = await getBackend();
  console.log(`Backend: ${backend.capabilities.name}`);
  const versionText = await getVersionText();
  console.log(`Version: ${versionText || 'N/A'}`);
  console.log();

  const hostAPIs = await getHostAPIs();
  const hostApiNames = new Map(hostAPIs.map(h => [h.id, h.name]));

  const devices = await getDevices();
  const defIn = backend.devices.getDefaultInputDevice();
  const defOut = backend.devices.getDefaultOutputDevice();

  const digits = String(devices.length - 1).length;

  for (const dev of devices) {
    const idx = typeof dev.id === 'number' ? dev.id : -1;
    const mark =
      idx === defIn && idx === defOut ? '*' :
      idx === defIn ? '>' :
      idx === defOut ? '<' : ' ';

    const haName = hostApiNames.get(dev.hostAPI) ?? `HostAPI ${dev.hostAPI}`;

    console.log(
      `${mark} ${String(idx).padStart(digits)} ${dev.name}, ` +
      `${haName} (${dev.maxInputChannels} in, ${dev.maxOutputChannels} out)`,
    );
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
