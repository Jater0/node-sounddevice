/**
 * PortAudio 原生插件加载器。
 *
 * 尝试加载 napi-rs 编译产物 (native/index.node)。
 * 如果插件未编译，抛出明确的错误提示。
 */

import type {
  DeviceInfo,
  HostAPIInfo,
} from '../../src/types.js';

/** 原生插件接口（napi-rs 导出的函数签名） */
export interface NativeAddon {
  // 初始化
  initialize(): void;
  terminate(): void;
  sleep(msec: number): void;

  // 设备
  getDeviceCount(): number;
  getDeviceInfo(index: number): DeviceInfo;
  getDefaultInputDevice(): number;
  getDefaultOutputDevice(): number;

  // 宿主 API
  getHostApiCount(): number;
  getHostApiInfo(index: number): HostAPIInfo;
  getDefaultHostApi(): number;

  // 检查
  getSampleSize(format: number): number;
  checkInputSettings(device: number, channels: number, sampleRate: number, format: number, latency: number): boolean;
  checkOutputSettings(device: number, channels: number, sampleRate: number, format: number, latency: number): boolean;

  // 版本
  getVersion(): number;
  getVersionText(): string;

  // 流
  openStream(
    inputDevice: number,
    outputDevice: number,
    inputChannels: number,
    outputChannels: number,
    sampleFormat: number,
    sampleRate: number,
    inputLatency: number,
    outputLatency: number,
    blockSize: number,
    flags: number,
    isInput: boolean,
    isOutput: boolean,
    hasCallback: boolean,
    asioChannelSelectors?: number[] | null,
    coreaudioChannelMap?: number[] | null,
    coreaudioFlags?: number | null,
    wasapiExclusive?: boolean | null,
    wasapiAutoConvert?: boolean | null,
    wasapiExplicitSampleFormat?: boolean | null,
  ): number;
  startStream(handle: number): void;
  setStreamFinishedCallback(handle: number): void;
  stopStream(handle: number): void;
  abortStream(handle: number): void;
  closeStream(handle: number): void;
  isStreamActive(handle: number): boolean;
  isStreamStopped(handle: number): boolean;
  getStreamInfo(handle: number): { inputLatency: number; outputLatency: number; sampleRate: number };
  getStreamTime(handle: number): number;
  getStreamCpuLoad(handle: number): number;
  readStream(handle: number, frames: number): Buffer;
  writeStream(handle: number, data: Buffer): void;
  getReadAvailable(handle: number): number;
  getWriteAvailable(handle: number): number;

  // 常量
  PA_FLOAT32: number;
  PA_INT32: number;
  PA_INT24: number;
  PA_INT16: number;
  PA_INT8: number;
  PA_UINT8: number;
  PA_NO_FLAG: number;
  PA_CLIP_OFF: number;
  PA_DITHER_OFF: number;
  PA_NEVER_DROP_INPUT: number;
  PA_PRIME_OUTPUT: number;
}

let _native: NativeAddon | null = null;
let _loadError: Error | null = null;

/**
 * 尝试加载原生插件。
 * 如果插件未编译，返回 null 并缓存错误信息。
 */
export function loadNative(): NativeAddon | null {
  if (_native) return _native;
  if (_loadError) return null;

  try {
    // napi-rs 编译产物位于 native/ 目录下
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _native = require('./native/index.node') as NativeAddon;
    // 自动初始化 PortAudio
    _native.initialize();
    return _native;
  } catch (err) {
    _loadError = err instanceof Error ? err : new Error(String(err));
    return null;
  }
}

/**
 * 获取加载错误信息（如果加载失败）。
 */
export function getLoadError(): Error | null {
  return _loadError;
}

/**
 * 确保原生插件已加载，否则抛出错误。
 */
export function requireNative(): NativeAddon {
  const native = loadNative();
  if (!native) {
    const msg = _loadError
      ? `PortAudio native addon failed to load: ${_loadError.message}`
      : 'PortAudio native addon not built. Run "cd backends/portaudio/native && npm run build"';
    throw new Error(msg);
  }
  return native;
}

/**
 * 样本格式字符串 → PortAudio 格式常量。
 */
export function sampleFormatToPa(format: string, native: NativeAddon): number {
  switch (format) {
    case 'float32': return native.PA_FLOAT32;
    case 'int32':   return native.PA_INT32;
    case 'int24':   return native.PA_INT24;
    case 'int16':   return native.PA_INT16;
    case 'int8':    return native.PA_INT8;
    case 'uint8':   return native.PA_UINT8;
    default: throw new Error(`Unknown sample format: ${format}`);
  }
}

/**
 * PortAudio 流标志位组合。
 */
export function computeFlags(
  native: NativeAddon,
  clipOff: boolean,
  ditherOff: boolean,
  neverDropInput: boolean,
  primeOutput: boolean,
): number {
  let flags = native.PA_NO_FLAG;
  if (clipOff) flags |= native.PA_CLIP_OFF;
  if (ditherOff) flags |= native.PA_DITHER_OFF;
  if (neverDropInput) flags |= native.PA_NEVER_DROP_INPUT;
  if (primeOutput) flags |= native.PA_PRIME_OUTPUT;
  return flags;
}
