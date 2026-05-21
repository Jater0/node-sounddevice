# node-sounddevice

> Play and Record Sound with Node.js / Electron / Browser
>
> TypeScript port of [python-sounddevice](https://github.com/spatialaudio/python-sounddevice/)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[中文](README_CN.md)

**node-sounddevice** provides a unified API for real-time audio I/O across platforms:

| Platform | Backend | Latency |
|---|---|---|
| Node.js / Electron | PortAudio (via napi-rs Rust addon) | Low (native) |
| Browser | Web Audio API (AudioWorklet) | Moderate (sandboxed) |

---

## Installation

```bash
npm install node-sounddevice
```

The package includes prebuilt native addons for:
- macOS x64 / arm64 (universal)
- Windows x64 / arm64
- Linux x64

No system dependencies needed on macOS and Windows (bundled PortAudio).  
On Linux, install `libportaudio2`:

```bash
# Debian / Ubuntu
sudo apt install libportaudio2

# Fedora
sudo dnf install portaudio

# Arch
sudo pacman -S portaudio
```

---

## Quick Start

```ts
import { getDevices, play } from 'node-sounddevice';

// List all audio devices
console.log(await getDevices());

// Play a 440 Hz sine wave for 2 seconds
const sr = 48000;
const duration = 2;
const t = Array.from({ length: sr * duration }, (_, i) => i / sr);
const data = new Float32Array(t.map(x => Math.sin(2 * Math.PI * 440 * x)));
await play(data, sr);
```

---

## API Overview

### Device Enumeration

```ts
import { getDevices, getHostAPIs, getVersionText } from 'node-sounddevice';

const devices = await getDevices();
// [
//   { id: 0, name: 'Built-in Microphone', maxInputChannels: 2, ... },
//   { id: 1, name: 'Built-in Output',     maxOutputChannels: 2, ... },
// ]

const hostAPIs = await getHostAPIs();
// [{ id: 0, name: 'MME', deviceCount: 5, ... }]

console.log(await getVersionText()); // "PortAudio V19.7.0-devel, revision unknown"
```

### Playback

```ts
import { play } from 'node-sounddevice';

// Blocking: wait until playback finishes
await play(audioData, 48000, { blocking: true });

// Non-blocking: return immediately
await play(audioData, 48000);

// Loop
await play(audioData, 48000, { loop: true, blocking: true });

// Channel mapping: send mono data to channel 2
await play(monoData, 48000, { mapping: [2] });

// Specify device
await play(audioData, 48000, { device: 'Built-in Output' });
```

Supported formats: `Float32Array`, `Int16Array`, `Int8Array`, `Uint8Array`.

### Recording

```ts
import { record } from 'node-sounddevice';

// Record 3 seconds at 48 kHz
const data = await record(3 * 48000, 48000);

// With custom channels
const stereo = await record(3 * 48000, 48000, { channels: 2 });

// Channel mapping: record only channel 3
const ch3 = await record(3 * 48000, 48000, { mapping: [3] });

// Record into existing array
const buf = new Float32Array(48000 * 2);
await record(48000, 48000, { out: buf, blocking: true });
```

### Control Functions

```ts
import { wait, stop, getStatus, getStream } from 'node-sounddevice';

// Wait for non-blocking play/rec to finish
await play(audioData, 48000);  // non-blocking
const flags = wait();          // wait + get status flags

// Stop current playback/recording
stop();

// Get status of last operation
const status = getStatus();    // CallbackFlags

// Get underlying stream reference
const stream = getStream();
console.log(stream.cpuLoad);
```

### Playback + Recording (Full-Duplex)

```ts
import { playRecord } from 'node-sounddevice';

const recorded = await playRecord(playbackData, 48000, {
  inputChannels: 1,
  inputMapping: [1],       // record from channel 1
  outputMapping: [1, 2],   // play to channels 1 and 2
  frames: 48000,
});
```

### Stream Classes (Low-Level)

```ts
import { getBackend } from 'node-sounddevice';

const backend = await getBackend();

// Callback mode — setImmediate polling loop, low latency
const stream = backend.openStream(
  'output',
  { sampleRate: 48000, channels: 1 },
  (indata, outdata, frames, time, status) => {
    for (let i = 0; i < frames; i++) {
      outdata![i] = Math.sin(2 * Math.PI * 440 * i / 48000);
    }
  },
  () => console.log('Stream finished'), // finished callback
);

stream.start();
// ... later
stream.stop();
stream.close();

// Blocking mode — simpler, for file playback/recording
const stream2 = backend.openStream('input', { sampleRate: 48000, channels: 2 });
stream2.start();

const block = stream2.read(1024); // Float32Array of 1024 frames
console.log(block.length); // 2048 (frames × channels)

stream2.stop();
stream2.close();

// Duplex with separate input/output devices
const duplex = backend.openStream(
  'duplex',
  {
    device: [micDeviceId, speakerDeviceId], // different devices
    channels: [2, 2],
    sampleRate: 48000,
  },
  callback,
);
```

### Global Defaults

```ts
import { defaults } from 'node-sounddevice';

defaults.sampleRate = 48000;
defaults.channels = [1, 2];  // input: 1, output: 2
defaults.device = 3;         // use device #3 for both
defaults.latency = 'low';    // low latency mode
defaults.reset();            // restore factory defaults
```

### Error Handling

```ts
import { AudioError, CallbackStop, CallbackAbort } from 'node-sounddevice';

// In stream callback:
function callback(indata, outdata, frames, time, status) {
  if (done) throw new CallbackStop();   // graceful stop
  if (error) throw new CallbackAbort(); // immediate abort
}
```

### Platform-Specific Settings

```ts
import { AsioSettings, CoreAudioSettings, WasapiSettings } from 'node-sounddevice';
import { defaults } from 'node-sounddevice';

// ASIO — select specific channels (Windows, ASIO driver required)
const asioOut = { type: 'asio', channelSelectors: [12, 13] } as AsioSettings;
await play(audioData, 48000, { extraSettings: asioOut });

// Core Audio — channel map (macOS only)
const caIn = { type: 'coreaudio', channelMap: [1, 3] } as CoreAudioSettings;
const caOut = { type: 'coreaudio', channelMap: [-1, -1, 0, -1, 1, -1] } as CoreAudioSettings;

// WASAPI — exclusive mode (Windows only)
const wasapi = { type: 'wasapi', exclusive: true } as WasapiSettings;
defaults.extraSettings = wasapi;
```

---

## Platform Features

### PortAudio Backend (Node.js / Electron)

- All sample formats: `float32`, `int32`, `int24`, `int16`, `int8`, `uint8`
- CPU load monitoring (`stream.cpuLoad`)
- Platform-specific settings: `AsioSettings`, `CoreAudioSettings`, `WasapiSettings`
- Duplex streams with separate input/output devices
- Both callback and blocking modes

### Web Audio Backend (Browser)

- Auto-detected in browsers
- `AudioWorklet` for low-latency (fallback: `ScriptProcessorNode`)
- Requires user gesture to start `AudioContext`
- Blocking read/write not supported (callback mode only)
- `int24` and platform settings not available

```ts
import { WebBackend } from 'node-sounddevice/web';
import { setBackend } from 'node-sounddevice';

setBackend(new WebBackend());
```

---

## Building from Source

### Prerequisites

- **Node.js** ≥ 16
- **Rust** ≥ 1.70 ([rustup](https://rustup.rs))
- **PortAudio** (Linux only: `libportaudio2` dev package)

### Steps

```bash
git clone <repo>
cd node-sounddevice
npm install
npm run build:native    # Compile Rust → .node
npm run build           # Compile TypeScript → dist/
npm test                # 21 tests
npx tsx examples/list_devices.ts
npx tsx examples/play_sine.ts 440
```

### Build Scripts

| Script | Description |
|---|---|
| `npm run build` | tsc + copy .node/DLLs to dist/ |
| `npm run build:native` | cargo build + copy-artifact.js |
| `npm test` | Unit tests (vitest) |
| `npm run list-devices` | Run list_devices example |
| `npm run play-sine` | Run play_sine example |

---

## Examples

| Example | Description |
|---|---|
| `examples/list_devices.ts` | Print all audio devices |
| `examples/play_sine.ts` | Play a sine wave (Ctrl+C to stop) |
| `examples/play_file.ts` | Play a WAV file |
| `examples/record.ts` | Record to a WAV file |

```bash
npx tsx examples/list_devices.ts
npx tsx examples/play_sine.ts 440 --amplitude 0.3
npx tsx examples/play_file.ts music.wav
npx tsx examples/record.ts 5 recording.wav
```

---

## Electron Usage

```ts
// Main process — direct PortAudio access
import { getDevices, play } from 'node-sounddevice';

// Renderer — via preload
// preload.ts
contextBridge.exposeInMainWorld('sounddevice', {
  getDevices: () => ipcRenderer.invoke('sounddevice:getDevices'),
});

// main.ts
ipcMain.handle('sounddevice:getDevices', () => getDevices());
```

> Audio callbacks run in a real-time thread. Keep stream processing in the main process or a Worker. IPC adds latency.

---

## Architecture

```
User Code
    ↓
src/index.ts           ←  auto-detects backend
src/convenience.ts     ←  play(), record(), playRecord(), wait(), stop(), ...
src/defaults.ts        ←  global settings
src/interfaces.ts      ←  IAudioStream, IDeviceManager, IBackend
    ↓
┌───────────────────────┬──────────────────────┐
│ backends/portaudio/   │ backends/web/        │
│ PortAudio via Rust    │ Web Audio API        │
│ napi-rs addon         │ AudioWorklet         │
│   ↓                   │   ↓                  │
│ libportaudio.{dylib|dll}  AudioContext       │
│   ↓                   │   ↓                  │
│ OS Audio Stack        │ Browser Audio Stack  │
└───────────────────────┴──────────────────────┘
```

---

## Roadmap

- [x] Phase 1: Core types, interfaces, errors, defaults
- [x] Phase 2: PortAudio backend — Rust FFI, device enum, stream lifecycle, callbacks
- [x] Phase 3: Web Audio backend (AudioWorklet)
- [x] Phase 4: Convenience functions + examples
- [x] Phase 5: Tests + CI
- [x] Phase 7: Platform settings — `AsioSettings`, `CoreAudioSettings`, `WasapiSettings`
- [ ] Phase 6: npm publish with prebuild binaries

---

## License

MIT — original Python: [python-sounddevice](https://github.com/spatialaudio/python-sounddevice/)

PortAudio binaries from [PortAudio](http://www.portaudio.com/) (MIT).  
ASIO SDK © Steinberg Media Technologies GmbH.
