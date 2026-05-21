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
import { getDevices, getHostAPIs } from 'node-sounddevice';

const devices = await getDevices();
// [
//   { id: 0, name: 'Built-in Microphone', maxInputChannels: 2, maxOutputChannels: 0, ... },
//   { id: 1, name: 'Built-in Output',     maxInputChannels: 0, maxOutputChannels: 2, ... },
// ]

const hostAPIs = await getHostAPIs();
// [{ id: 0, name: 'Core Audio', deviceCount: 3, ... }]
```

### Playback

```ts
import { play } from 'node-sounddevice';

// Blocking: wait until playback finishes
await play(audioData, 48000, { blocking: true });

// Non-blocking: return immediately, playback continues in background
await play(audioData, 48000);

// Loop
await play(audioData, 48000, { loop: true, blocking: true });

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
```

### Simultaneous Playback & Recording (Full-Duplex)

```ts
import { playRecord } from 'node-sounddevice';

const recorded = await playRecord(playbackData, 48000, {
  inputChannels: 1,
  frames: 48000,
});
```

### Stream Classes (Low-Level)

```ts
import { getBackend } from 'node-sounddevice';

const backend = await getBackend();

// Callback mode — real-time, low latency
const stream = backend.openStream(
  'output',
  { sampleRate: 48000, channels: 1 },
  (indata, outdata, frames, time, status) => {
    // Fill outdata with audio samples
    for (let i = 0; i < frames; i++) {
      outdata[i] = Math.sin(2 * Math.PI * 440 * i / 48000);
    }
  },
);

stream.start();
// ... later
stream.stop();
stream.close();

// Blocking mode — simpler, for non-real-time use
const stream2 = backend.openStream('input', { sampleRate: 48000, channels: 2 });
stream2.start();

const block = stream2.read(1024); // Float32Array of 1024 frames
console.log(block.length); // 2048 (frames × channels)

stream2.stop();
stream2.close();
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

---

## Platform-Specific Features

### PortAudio Backend (Node.js / Electron)

- All PortAudio sample formats: `float32`, `int32`, `int24`, `int16`, `int8`, `uint8`
- CPU load monitoring (`stream.cpuLoad`)
- Host-API specific settings (CoreAudio, WASAPI, ASIO — Phase 2b)
- Real-time priority callbacks

### Web Audio Backend (Browser)

- Auto-detected when running in a browser
- Uses `AudioWorklet` for low-latency processing
- Falls back to `ScriptProcessorNode` on older browsers
- Requires user gesture to start `AudioContext`
- Blocking read/write not supported (callback mode only)
- `int24` format not available

```ts
// Explicit backend selection (optional)
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
# 1. Clone
git clone <repo>
cd node-sounddevice

# 2. Install JS dependencies
npm install

# 3. Build TypeScript
npm run build

# 4. Build native addon (Rust → .node)
cd backends/portaudio/native
npm run build
cd ../../..

# 5. Run tests
npm test

# 6. Try examples
npx ts-node examples/list_devices.ts
npx ts-node examples/play_sine.ts 440
```

### Build Scripts

| Script | Description |
|---|---|
| `npm run build` | Compile TypeScript → `dist/` |
| `npm run build:native` | Compile Rust addon (alias for `cd backends/portaudio/native && npm run build`) |
| `npm test` | Run unit tests (vitest) |
| `npm run test:web` | Run tests with jsdom (browser simulation) |

### Native Build Details

The Rust addon lives in `backends/portaudio/native/`:

```
backends/portaudio/native/
├── Cargo.toml              # napi-rs project
├── build.rs                # Links PortAudio
├── portaudio-binaries/     # Prebuilt .dylib / .dll
│   ├── libportaudio.dylib          # macOS universal
│   ├── libportaudio64bit.dll       # Windows x64
│   ├── libportaudioarm64.dll       # Windows arm64
│   └── ...                        # 32-bit + ASIO variants
└── src/
    ├── lib.rs               # N-API entry point
    ├── ffi.rs               # PortAudio C bindings
    ├── device.rs            # Device enumeration
    ├── stream.rs            # Stream lifecycle
    └── error.rs             # Error mapping
```

On macOS and Windows, PortAudio is linked from the bundled binaries.  
On Linux, PortAudio is linked from the system library (`pkg-config portaudio-2.0`).

---

## Examples

| Example | Description |
|---|---|
| `examples/list_devices.ts` | Print all audio devices |
| `examples/play_sine.ts` | Play a sine wave (Ctrl+C to stop) |
| `examples/play_file.ts` | Play a WAV file |
| `examples/record.ts` | Record to a WAV file |

Run with:

```bash
npx ts-node examples/list_devices.ts
npx ts-node examples/play_sine.ts 440 --amplitude 0.3
npx ts-node examples/play_file.ts music.wav
npx ts-node examples/record.ts 5 recording.wav
```

---

## Electron Usage

```ts
// Main process — direct access to PortAudio backend
import { getDevices, play } from 'node-sounddevice';

// Renderer process — expose via preload
// preload.ts
import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('sounddevice', {
  getDevices: () => ipcRenderer.invoke('sounddevice:getDevices'),
  play: (data, sr) => ipcRenderer.invoke('sounddevice:play', data, sr),
});

// main.ts
ipcMain.handle('sounddevice:getDevices', async () => {
  return getDevices();
});
```

> **Note:** Audio callbacks run in a real-time thread. For low-latency use cases, keep stream processing in the main process or a Worker thread. IPC adds latency.

---

## Architecture

```
User Code
    ↓
src/index.ts           ←  auto-detects backend
src/convenience.ts     ←  play(), record(), playRecord()
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
- [x] Phase 2a: PortAudio backend — Rust FFI + device enumeration
- [x] Phase 2b: Stream lifecycle — blocking read/write + stream control
- [x] Phase 3: Web Audio backend (AudioWorklet)
- [x] Phase 4: Convenience functions + examples
- [x] Phase 5: Tests + CI
- [ ] Phase 2c: Callback mode (ThreadsafeFunction bridge to JS)
- [ ] Phase 6: npm package publishing with prebuild binaries
- [ ] Phase 7: ASIO host-API specific settings

---

## License

MIT — see [python-sounddevice](https://github.com/spatialaudio/python-sounddevice/) for the original Python implementation.

PortAudio binaries are from [PortAudio](http://www.portaudio.com/) (MIT License).  
ASIO SDK is © Steinberg Media Technologies GmbH.
