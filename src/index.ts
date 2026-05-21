/**
 * node-sounddevice — 跨平台音频 I/O
 *
 * 自动检测运行环境并加载对应后端：
 * - Node.js / Electron → PortAudio 后端（napi-rs 原生插件）
 * - 浏览器 → Web Audio 后端（AudioWorklet）
 *
 * 用法：
 * ```ts
 * import { getDevices, play, AudioStream } from 'node-sounddevice';
 *
 * // 列出设备
 * console.log(getDevices());
 *
 * // 播放正弦波
 * const sr = 48000;
 * const buffer = generateSine(440, sr, sr); // 1 秒 440Hz
 * play(buffer, sr);
 * ```
 */

import type { IBackend } from './interfaces';
import type {
  DeviceInfo,
  HostAPIInfo,
  StreamOptions,
  DuplexStreamOptions,
  StreamKind,
  StreamInfo,
  StreamTime,
  SampleFormat,
  CallbackFlag,
  BackendCapabilities,
} from './types';
import type {
  IAudioStream,
  IDeviceManager,
  StreamCallback,
  StreamFinishedCallback,
} from './interfaces';

// 重新导出核心类型和接口
export type {
  DeviceInfo,
  HostAPIInfo,
  StreamOptions,
  DuplexStreamOptions,
  StreamKind,
  StreamInfo,
  StreamTime,
  SampleFormat,
  CallbackFlag,
  BackendCapabilities,
};

export type {
  IAudioStream,
  IDeviceManager,
  IBackend,
  StreamCallback,
  StreamFinishedCallback,
};

export {
  AudioError,
  CallbackStop,
  CallbackAbort,
  isCallbackControl,
} from './errors';

export { defaults } from './defaults';
export { splitPair, selectFromPair } from './defaults';
export type { InputOutputPair } from './defaults';

// ─── 后端加载 ──────────────────────────────────────

let _backend: IBackend | null = null;
let _backendPromise: Promise<IBackend> | null = null;

/**
 * 获取当前后端实例。
 * 首次调用时自动检测环境并加载对应后端。
 *
 * 检测逻辑：
 * - 浏览器环境 (typeof window !== 'undefined') → Web Audio 后端
 * - Node.js / Electron → PortAudio 后端
 */
export async function getBackend(): Promise<IBackend> {
  if (_backend) return _backend;
  if (_backendPromise) return _backendPromise;

  _backendPromise = (async (): Promise<IBackend> => {
    const isBrowser =
      typeof window !== 'undefined' && typeof window.document !== 'undefined';

    if (isBrowser) {
      const { WebBackend } = await import('../backends/web/index.js');
      _backend = new WebBackend();
    } else {
      const { PortAudioBackend } = await import('../backends/portaudio/index.js');
      _backend = new PortAudioBackend();
    }

    return _backend;
  })();

  return _backendPromise;
}

/**
 * 手动设置后端（用于测试或特殊场景）。
 * 必须在调用任何 API 之前设置。
 */
export function setBackend(backend: IBackend): void {
  if (_backend) {
    throw new Error('Backend already initialized. Call setBackend() before any API calls.');
  }
  _backend = backend;
}

/**
 * 同步获取后端（如果已初始化）。
 * 未初始化时返回 null。
 */
export function getBackendSync(): IBackend | null {
  return _backend;
}

// ─── 便捷 API ──────────────────────────────────────

/**
 * 获取所有可用音频设备。
 * 对应 python-sounddevice 的 query_devices()。
 */
export async function getDevices(): Promise<DeviceInfo[]> {
  const backend = await getBackend();
  return backend.devices.getDevices();
}

/**
 * 获取所有宿主 API。
 * 对应 python-sounddevice 的 query_hostapis()。
 * 注意：Web 后端可能返回空数组或单个伪 API。
 */
export async function getHostAPIs(): Promise<HostAPIInfo[]> {
  const backend = await getBackend();
  return backend.devices.getHostAPIs();
}

/**
 * 获取 PortAudio 版本号（Web 后端返回空字符串）。
 */
export async function getVersion(): Promise<string> {
  const backend = await getBackend();
  return backend.getVersion();
}

/**
 * 获取 PortAudio 版本文本。
 */
export async function getVersionText(): Promise<string> {
  const backend = await getBackend();
  return backend.getVersionText();
}

export { play, record, playRecord } from './convenience.js';

/**
 * 休眠（毫秒）。
 * 对应 python-sounddevice 的 sleep()。
 */
export async function sleep(msec: number): Promise<void> {
  const backend = await getBackend();
  return backend.sleep(msec);
}
