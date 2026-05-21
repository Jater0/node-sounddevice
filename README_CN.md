# node-sounddevice

> 用 Node.js / Electron / 浏览器 播放和录制音频
>
> [python-sounddevice](https://github.com/spatialaudio/python-sounddevice/) 的 TypeScript 移植

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[English](README.md)

**node-sounddevice** 为跨平台实时音频 I/O 提供统一 API：

| 平台 | 后端 | 延迟 |
|---|---|---|
| Node.js / Electron | PortAudio（通过 napi-rs Rust 插件） | 低（原生） |
| 浏览器 | Web Audio API（AudioWorklet） | 中（沙箱） |

---

## 安装

```bash
npm install node-sounddevice
```

包含以下平台的预编译原生插件：
- macOS x64 / arm64（通用二进制）
- Windows x64 / arm64
- Linux x64

macOS 和 Windows 无需系统依赖（内置 PortAudio）。  
Linux 需要安装 `libportaudio2`：

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
const duration = 2;
const t = Array.from({ length: sr * duration }, (_, i) => i / sr);
const data = new Float32Array(t.map(x => Math.sin(2 * Math.PI * 440 * x)));
await play(data, sr);
```

---

## API 概览

### 设备枚举

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

### 播放

```ts
import { play } from 'node-sounddevice';

// 阻塞模式：等待播放完成
await play(audioData, 48000, { blocking: true });

// 非阻塞模式：立即返回，后台播放
await play(audioData, 48000);

// 循环播放
await play(audioData, 48000, { loop: true, blocking: true });

// 指定设备
await play(audioData, 48000, { device: 'Built-in Output' });
```

支持的格式：`Float32Array`、`Int16Array`、`Int8Array`、`Uint8Array`。

### 录制

```ts
import { record } from 'node-sounddevice';

// 录制 3 秒，48 kHz
const data = await record(3 * 48000, 48000);

// 自定义通道数
const stereo = await record(3 * 48000, 48000, { channels: 2 });
```

### 同时播放和录制（全双工）

```ts
import { playRecord } from 'node-sounddevice';

const recorded = await playRecord(playbackData, 48000, {
  inputChannels: 1,
  frames: 48000,
});
```

### 流类（低级 API）

```ts
import { getBackend } from 'node-sounddevice';

const backend = await getBackend();

// 回调模式 — 实时、低延迟
const stream = backend.openStream(
  'output',
  { sampleRate: 48000, channels: 1 },
  (indata, outdata, frames, time, status) => {
    // 填充 outdata
    for (let i = 0; i < frames; i++) {
      outdata[i] = Math.sin(2 * Math.PI * 440 * i / 48000);
    }
  },
);

stream.start();
// ... 稍后
stream.stop();
stream.close();

// 阻塞模式 — 更简单，适合非实时场景
const stream2 = backend.openStream('input', { sampleRate: 48000, channels: 2 });
stream2.start();

const block = stream2.read(1024); // Float32Array，1024 帧
console.log(block.length); // 2048（帧 × 通道）

stream2.stop();
stream2.close();
```

### 全局默认值

```ts
import { defaults } from 'node-sounddevice';

defaults.sampleRate = 48000;
defaults.channels = [1, 2];  // 输入 1 通道，输出 2 通道
defaults.device = 3;         // 输入输出都使用设备 #3
defaults.latency = 'low';    // 低延迟模式
defaults.reset();            // 恢复出厂默认值
```

### 错误处理

```ts
import { AudioError, CallbackStop, CallbackAbort } from 'node-sounddevice';

// 在流回调中：
function callback(indata, outdata, frames, time, status) {
  if (done) throw new CallbackStop();   // 正常停止（等待缓冲播放完）
  if (error) throw new CallbackAbort(); // 立即中止（丢弃缓冲）
}
```

---

## 平台特性

### PortAudio 后端（Node.js / Electron）

- 支持所有 PortAudio 样本格式：`float32`、`int32`、`int24`、`int16`、`int8`、`uint8`
- CPU 负载监控（`stream.cpuLoad`）
- 宿主 API 特定设置（CoreAudio、WASAPI、ASIO — Phase 2b）
- 实时优先级回调

### Web Audio 后端（浏览器）

- 浏览器环境自动检测
- 使用 `AudioWorklet` 实现低延迟处理
- 旧浏览器降级到 `ScriptProcessorNode`
- 需要用户手势启动 `AudioContext`
- 不支持阻塞读写（仅回调模式）
- 不支持 `int24` 格式

```ts
// 手动指定后端（可选）
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
# 1. 克隆
git clone <repo>
cd node-sounddevice

# 2. 安装 JS 依赖
npm install

# 3. 编译 TypeScript
npm run build

# 4. 编译原生插件（Rust → .node）
cd backends/portaudio/native
npm run build
cd ../../..

# 5. 运行测试
npm test

# 6. 运行示例
npx ts-node examples/list_devices.ts
npx ts-node examples/play_sine.ts 440
```

### 构建脚本

| 脚本 | 说明 |
|---|---|
| `npm run build` | 编译 TypeScript → `dist/` |
| `npm run build:native` | 编译 Rust 插件 |
| `npm test` | 运行单元测试（vitest） |
| `npm run test:web` | 使用 jsdom 模拟浏览器测试 |

### 原生插件构建细节

Rust 插件位于 `backends/portaudio/native/`：

```
backends/portaudio/native/
├── Cargo.toml              # napi-rs 项目
├── build.rs                # 链接 PortAudio
├── portaudio-binaries/     # 预编译 .dylib / .dll
│   ├── libportaudio.dylib          # macOS 通用二进制
│   ├── libportaudio64bit.dll       # Windows x64
│   ├── libportaudioarm64.dll       # Windows arm64
│   └── ...                        # 32-bit + ASIO 变体
└── src/
    ├── lib.rs               # N-API 入口
    ├── ffi.rs               # PortAudio C 绑定
    ├── device.rs            # 设备枚举
    ├── stream.rs            # 流生命周期
    └── error.rs             # 错误映射
```

macOS 和 Windows 上从内置二进制链接 PortAudio。  
Linux 上从系统库链接（`pkg-config portaudio-2.0`）。

---

## 示例

| 示例 | 说明 |
|---|---|
| `examples/list_devices.ts` | 列出所有音频设备 |
| `examples/play_sine.ts` | 播放正弦波（Ctrl+C 停止） |
| `examples/play_file.ts` | 播放 WAV 文件 |
| `examples/record.ts` | 录制到 WAV 文件 |

运行：

```bash
npx ts-node examples/list_devices.ts
npx ts-node examples/play_sine.ts 440 --amplitude 0.3
npx ts-node examples/play_file.ts music.wav
npx ts-node examples/record.ts 5 recording.wav
```

---

## Electron 使用

```ts
// 主进程 — 直接访问 PortAudio 后端
import { getDevices, play } from 'node-sounddevice';

// 渲染进程 — 通过 preload 暴露
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

> **注意：** 音频回调在实时线程中运行。低延迟场景请将流处理放在主进程或 Worker 线程中。IPC 会增加延迟。

---

## 架构

```
用户代码
    ↓
src/index.ts           ←  自动检测后端
src/convenience.ts     ←  play(), record(), playRecord()
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
- [x] Phase 2a：PortAudio 后端 — Rust FFI + 设备枚举（骨架）
- [x] Phase 3：Web Audio 后端（AudioWorklet）
- [x] Phase 4：便捷函数 + 示例
- [x] Phase 5：测试 + CI
- [ ] Phase 2b：完善流生命周期（ThreadsafeFunction 回调、阻塞读写）
- [ ] Phase 6：npm 发布（含预编译二进制）
- [ ] Phase 7：ASIO 宿主 API 特定设置

---

## 许可证

MIT — 原始 Python 实现见 [python-sounddevice](https://github.com/spatialaudio/python-sounddevice/)。

PortAudio 二进制来自 [PortAudio](http://www.portaudio.com/)（MIT 许可证）。  
ASIO SDK © Steinberg Media Technologies GmbH。
