# node-sounddevice

> 用 Node.js / Electron / 浏览器 播放和录制音频
>
> [python-sounddevice](https://github.com/spatialaudio/python-sounddevice/) 的 TypeScript 移植

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[English](README.md)

**node-sounddevice** 为跨平台实时音频 I/O 提供统一 API：

| 平台 | 后端 | 延迟 |
|---|---|---|
| Node.js / Electron | PortAudio（napi-rs Rust 插件） | 低（原生） |
| 浏览器 | Web Audio API（AudioWorklet） | 中（沙箱） |

---

## 安装

```bash
npm install node-sounddevice
```

预编译原生插件支持：
- macOS x64 / arm64（通用二进制）
- Windows x64 / arm64
- Linux x64

macOS 和 Windows 无需系统依赖（内置 PortAudio）。  
Linux 需安装 `libportaudio2`：

```bash
# Debian / Ubuntu
sudo apt install libportaudio2

# Fedora
sudo dnf install portaudio

# Arch
sudo pacman -S portaudio
```

---

## 快速开始

```ts
import { getDevices, play } from 'node-sounddevice';

// 列出所有音频设备
console.log(await getDevices());

// 播放 440 Hz 正弦波 2 秒
const sr = 48000;
const t = Array.from({ length: sr * 2 }, (_, i) => i / sr);
const data = new Float32Array(t.map(x => Math.sin(2 * Math.PI * 440 * x)));
await play(data, sr);
```

---

## API 概览

### 设备枚举

```ts
import { getDevices, getHostAPIs, getVersionText } from 'node-sounddevice';

const devices = await getDevices();
// [{ id: 0, name: 'Built-in Microphone', maxInputChannels: 2, ... }, ...]

const hostAPIs = await getHostAPIs();
// [{ id: 0, name: 'MME', deviceCount: 5, ... }]

console.log(await getVersionText()); // "PortAudio V19.7.0-devel, revision unknown"
```

### 播放

```ts
import { play } from 'node-sounddevice';

// 阻塞模式：等待播放完成
await play(audioData, 48000, { blocking: true });

// 非阻塞模式：立即返回，后台播放
await play(audioData, 48000);

// 循环播放
await play(audioData, 48000, { loop: true, blocking: true });

// 通道映射：单声道数据发送到第 2 通道
await play(monoData, 48000, { mapping: [2] });

// 指定设备
await play(audioData, 48000, { device: 'Built-in Output' });
```

支持格式：`Float32Array`、`Int16Array`、`Int8Array`、`Uint8Array`。

### 录制

```ts
import { record } from 'node-sounddevice';

// 录制 3 秒，48 kHz
const data = await record(3 * 48000, 48000);

// 自定义通道数
const stereo = await record(3 * 48000, 48000, { channels: 2 });

// 通道映射：只录第 3 通道
const ch3 = await record(3 * 48000, 48000, { mapping: [3] });

// 录制到已有数组
const buf = new Float32Array(48000 * 2);
await record(48000, 48000, { out: buf, blocking: true });
```

### 控制函数

```ts
import { wait, stop, getStatus, getStream } from 'node-sounddevice';

// 等待非阻塞 play/rec 完成
await play(audioData, 48000);  // 非阻塞
const flags = wait();          // 等待完成 + 获取状态

// 停止当前播放/录制
stop();

// 获取上轮操作状态
const status = getStatus();    // CallbackFlags

// 获取底层流引用
const stream = getStream();
console.log(stream.cpuLoad);
```

### 同时播放和录制（全双工）

```ts
import { playRecord } from 'node-sounddevice';

const recorded = await playRecord(playbackData, 48000, {
  inputChannels: 1,
  inputMapping: [1],       // 从通道 1 录制
  outputMapping: [1, 2],   // 向通道 1 和 2 播放
  frames: 48000,
});
```

### 流类（低级 API）

```ts
import { getBackend } from 'node-sounddevice';

const backend = await getBackend();

// 回调模式 — setImmediate 轮询，低延迟
const stream = backend.openStream(
  'output',
  { sampleRate: 48000, channels: 1 },
  (indata, outdata, frames, time, status) => {
    for (let i = 0; i < frames; i++) {
      outdata![i] = Math.sin(2 * Math.PI * 440 * i / 48000);
    }
  },
  () => console.log('Stream finished'), // 完成回调
);

stream.start();
// ... 稍后
stream.stop();
stream.close();

// 阻塞模式 — 更简单
const stream2 = backend.openStream('input', { sampleRate: 48000, channels: 2 });
stream2.start();
const block = stream2.read(1024); // Float32Array，1024 帧
stream2.stop();
stream2.close();

// 双工 + 分离输入/输出设备
const duplex = backend.openStream(
  'duplex',
  { device: [micDeviceId, speakerDeviceId], channels: [2, 2], sampleRate: 48000 },
  callback,
);
```

### 全局默认值

```ts
import { defaults } from 'node-sounddevice';

defaults.sampleRate = 48000;
defaults.channels = [1, 2];  // 输入 1，输出 2
defaults.device = 3;         // 都用设备 #3
defaults.latency = 'low';    // 低延迟模式
defaults.reset();            // 恢复出厂
```

### 错误处理

```ts
import { AudioError, CallbackStop, CallbackAbort } from 'node-sounddevice';

function callback(indata, outdata, frames, time, status) {
  if (done) throw new CallbackStop();   // 正常停止
  if (error) throw new CallbackAbort(); // 立即中止
}
```

### 平台特定设置

```ts
import { AsioSettings, CoreAudioSettings, WasapiSettings } from 'node-sounddevice';

// ASIO — 选择特定通道（Windows，需要 ASIO 驱动）
const asioOut = { type: 'asio', channelSelectors: [12, 13] } as AsioSettings;
await play(audioData, 48000, { extraSettings: asioOut });

// Core Audio — 通道映射（仅 macOS）
const caIn = { type: 'coreaudio', channelMap: [1, 3] } as CoreAudioSettings;
const caOut = { type: 'coreaudio', channelMap: [-1, -1, 0, -1, 1, -1] } as CoreAudioSettings;

// WASAPI — 独占模式（仅 Windows）
const wasapi = { type: 'wasapi', exclusive: true } as WasapiSettings;
```

---

## 平台特性

### PortAudio 后端（Node.js / Electron）

- 所有格式：`float32`、`int32`、`int24`、`int16`、`int8`、`uint8`
- CPU 负载监控（`stream.cpuLoad`）
- 平台特定设置：`AsioSettings`、`CoreAudioSettings`、`WasapiSettings`
- 双工流分离输入/输出设备
- 回调 + 阻塞双模式

### Web Audio 后端（浏览器）

- 浏览器自动检测
- `AudioWorklet` 低延迟（降级：`ScriptProcessorNode`）
- 需要用户手势启动 `AudioContext`
- 不支持阻塞读写（仅回调模式）
- 不支持 `int24` 和平台设置

```ts
import { WebBackend } from 'node-sounddevice/web';
import { setBackend } from 'node-sounddevice';
setBackend(new WebBackend());
```

---

## 从源码构建

### 前置条件

- **Node.js** ≥ 16
- **Rust** ≥ 1.70（[rustup](https://rustup.rs)）
- **PortAudio**（仅 Linux：`libportaudio2` 开发包）

### 步骤

```bash
git clone <repo>
cd node-sounddevice
npm install
npm run build:native    # 编译 Rust → .node
npm run build           # 编译 TypeScript → dist/
npm test                # 21 个测试
npx tsx examples/list_devices.ts
npx tsx examples/play_sine.ts 440
```

### 构建脚本

| 脚本 | 说明 |
|---|---|
| `npm run build` | tsc + 复制 .node/DLL 到 dist/ |
| `npm run build:native` | cargo build + copy-artifact.js |
| `npm test` | 单元测试（vitest） |
| `npm run list-devices` | 运行设备列表示例 |
| `npm run play-sine` | 运行正弦波示例 |

---

## 示例

| 示例 | 说明 |
|---|---|
| `examples/list_devices.ts` | 列出所有音频设备 |
| `examples/play_sine.ts` | 播放正弦波（Ctrl+C 停止） |
| `examples/play_file.ts` | 播放 WAV 文件 |
| `examples/record.ts` | 录制到 WAV 文件 |
| `examples/web_demo.html` | 浏览器演示 — 列设备 + 播正弦波 |

```bash
# Node.js
npx tsx examples/list_devices.ts
npx tsx examples/play_sine.ts 440 --amplitude 0.3
npx tsx examples/play_file.ts music.wav
npx tsx examples/record.ts 5 recording.wav

# 浏览器演示
npm run serve-web
# 打开 http://localhost:8080/examples/web_demo.html
```

---

## Electron 使用

```ts
// 主进程 — 直接访问 PortAudio
import { getDevices, play } from 'node-sounddevice';

// 渲染进程 — 通过 preload
contextBridge.exposeInMainWorld('sounddevice', {
  getDevices: () => ipcRenderer.invoke('sounddevice:getDevices'),
});
ipcMain.handle('sounddevice:getDevices', () => getDevices());
```

> 音频回调在实时线程中运行。低延迟场景请放在主进程或 Worker 中。IPC 会增加延迟。

---

## 架构

```
用户代码
    ↓
src/index.ts           ←  自动检测后端
src/convenience.ts     ←  play/record/playRecord/wait/stop/getStatus/getStream
src/defaults.ts        ←  全局设置
src/interfaces.ts      ←  IAudioStream, IDeviceManager, IBackend
    ↓
┌───────────────────────┬──────────────────────┐
│ backends/portaudio/   │ backends/web/        │
│ PortAudio (Rust 插件)  │ Web Audio API        │
│   ↓                   │   ↓                  │
│ libportaudio.{dylib|dll}  AudioContext       │
│   ↓                   │   ↓                  │
│ 操作系统音频栈           │ 浏览器音频栈          │
└───────────────────────┴──────────────────────┘
```

---

## 开发路线

- [x] Phase 1：核心类型、接口、错误、默认值
- [x] Phase 2：PortAudio 后端 — Rust FFI、设备枚举、流生命周期、回调
- [x] Phase 3：Web Audio 后端（AudioWorklet）
- [x] Phase 4：便捷函数 + 示例
- [x] Phase 5：测试 + CI
- [x] Phase 7：平台设置 — `AsioSettings`、`CoreAudioSettings`、`WasapiSettings`
- [ ] Phase 6：npm 发布（含预编译二进制）

---

## 许可证

MIT — 原始 Python 实现：[python-sounddevice](https://github.com/spatialaudio/python-sounddevice/)

PortAudio 二进制来自 [PortAudio](http://www.portaudio.com/)（MIT）。  
ASIO SDK © Steinberg Media Technologies GmbH。
