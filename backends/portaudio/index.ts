/**
 * PortAudio 后端 — Electron / Node.js
 *
 * 使用 napi-rs 原生插件 (native/index.node) 调用 PortAudio C 库。
 * 如果原生插件未编译，所有操作抛出明确错误。
 */

import type {
  IBackend,
  IAudioStream,
  IDeviceManager,
  StreamCallback,
  StreamFinishedCallback,
} from '../../src/interfaces.js';
import type {
  DeviceInfo,
  HostAPIInfo,
  StreamOptions,
  DuplexStreamOptions,
  StreamKind,
  SampleFormat,
  BackendCapabilities,
  LatencyHint,
  CallbackFlag,
  StreamInfo,
  StreamTime,
} from '../../src/types.js';
import { AudioError, CallbackStop, CallbackAbort } from '../../src/errors.js';
import { defaults, splitPair, selectFromPair } from '../../src/defaults.js';
import {
  loadNative,
  requireNative,
  sampleFormatToPa,
  computeFlags,
} from './native.js';
import type { NativeAddon } from './native.js';

// ─── 辅助 ─────────────────────────────────────────

function getDeviceId(
  native: NativeAddon,
  nameOrId: number | string,
  kind: 'input' | 'output',
  raiseOnError: boolean = false,
): number {
  if (typeof nameOrId === 'number') return nameOrId;

  const queryStr = nameOrId.toLowerCase();
  const substrings = queryStr.split(/\s+/);
  const count = native.getDeviceCount();
  const matches: Array<{ id: number; fullName: string }> = [];
  const exactMatches: number[] = [];

  for (let i = 0; i < count; i++) {
    const info = native.getDeviceInfo(i);
    if (kind === 'input' && info.maxInputChannels === 0) continue;
    if (kind === 'output' && info.maxOutputChannels === 0) continue;

    const hostApiInfo = native.getHostApiInfo(info.hostAPI);
    const fullName = `${info.name}, ${hostApiInfo.name}`;
    const fullLower = fullName.toLowerCase();

    let pos = 0;
    let allMatch = true;
    for (const sub of substrings) {
      pos = fullLower.indexOf(sub, pos);
      if (pos < 0) { allMatch = false; break; }
      pos += sub.length;
    }
    if (allMatch) {
      matches.push({ id: i, fullName });
      if (queryStr === info.name.toLowerCase() || queryStr === fullLower) {
        exactMatches.push(i);
      }
    }
  }

  if (matches.length === 0) {
    if (raiseOnError) {
      throw new AudioError(`No ${kind} device matching "${nameOrId}"`);
    }
    return -1;
  }
  if (matches.length > 1 && exactMatches.length === 1) {
    return exactMatches[0]!;
  }
  if (matches.length > 1 && raiseOnError) {
    const list = matches.map(m => `[${m.id}] ${m.fullName}`).join('\n');
    throw new AudioError(`Multiple ${kind} devices found for "${nameOrId}":\n${list}`);
  }
  return matches[0]!.id;
}

/** Convert CoreAudio settings to PortAudio flags */
function coreaudioFlagsToNum(s: Record<string, unknown>): number {
  const qualityMap: Record<string, number> = {
    min: 0x0100,
    low: 0x0300,
    medium: 0x0200,
    high: 0x0400,
    max: 0x0000,
  };
  let flags = qualityMap[(s.conversionQuality as string) ?? 'max'] ?? 0x0000;
  if (s.changeDeviceParameters) flags |= 0x01;
  if (s.failIfConversionRequired) flags |= 0x02;
  return flags;
}

function resolveLatency(
  latency: LatencyHint,
  deviceInfo: DeviceInfo,
  kind: 'input' | 'output',
): number {
  if (typeof latency === 'number') return latency;
  if (latency === 'low') {
    return kind === 'input'
      ? deviceInfo.defaultLowInputLatency
      : deviceInfo.defaultLowOutputLatency;
  }
  return kind === 'input'
    ? deviceInfo.defaultHighInputLatency
    : deviceInfo.defaultHighOutputLatency;
}

// ─── PortAudioDeviceManager ───────────────────────

class PortAudioDeviceManager implements IDeviceManager {
  private _native: NativeAddon | null = null;

  private get native(): NativeAddon {
    if (!this._native) this._native = requireNative();
    return this._native;
  }

  getDevices(): DeviceInfo[] {
    const n = this.native;
    const count = n.getDeviceCount();
    const result: DeviceInfo[] = [];
    for (let i = 0; i < count; i++) {
      result.push(n.getDeviceInfo(i));
    }
    return result;
  }

  getHostAPIs(): HostAPIInfo[] {
    const n = this.native;
    const count = n.getHostApiCount();
    const result: HostAPIInfo[] = [];
    for (let i = 0; i < count; i++) {
      result.push(n.getHostApiInfo(i));
    }
    return result;
  }

  getDefaultInputDevice(): number {
    return this.native.getDefaultInputDevice();
  }

  getDefaultOutputDevice(): number {
    return this.native.getDefaultOutputDevice();
  }

  getDeviceId(nameOrId: number | string, kind?: 'input' | 'output'): number {
    return getDeviceId(this.native, nameOrId, kind ?? 'output', true);
  }

  checkInputSettings(
    device?: number,
    channels?: number,
    sampleRate?: number,
    dtype?: SampleFormat,
    latency?: number,
  ): boolean {
    const n = this.native;
    const dev = device ?? n.getDefaultInputDevice();
    const ch = channels ?? 1;
    const sr = sampleRate ?? n.getDeviceInfo(dev).defaultSampleRate;
    const fmt = dtype ? sampleFormatToPa(dtype, n) : n.PA_FLOAT32;
    const lat = latency ?? 0.1;
    return n.checkInputSettings(dev, ch, sr, fmt, lat);
  }

  checkOutputSettings(
    device?: number,
    channels?: number,
    sampleRate?: number,
    dtype?: SampleFormat,
    latency?: number,
  ): boolean {
    const n = this.native;
    const dev = device ?? n.getDefaultOutputDevice();
    const ch = channels ?? 1;
    const sr = sampleRate ?? n.getDeviceInfo(dev).defaultSampleRate;
    const fmt = dtype ? sampleFormatToPa(dtype, n) : n.PA_FLOAT32;
    const lat = latency ?? 0.1;
    return n.checkOutputSettings(dev, ch, sr, fmt, lat);
  }
}

// ─── PortAudioStream ──────────────────────────────

class PortAudioStream implements IAudioStream {
  private _native: NativeAddon;
  private _handle: number;
  private _sampleRate: number;
  private _blockSize: number;
  private _channels: number | [number, number];
  private _dtype: SampleFormat | [SampleFormat, SampleFormat];
  private _sampleSize: number | [number, number];
  private _latency: number | [number, number];
  private _device: number | string | [number | string, number | string];
  private _kind: StreamKind;
  private _fmtPa: number;
  private _closed: boolean = false;
  private _callback: StreamCallback | null;
  private _finishedCallback: StreamFinishedCallback | null;
  private _polling: boolean = false;
  private _started: boolean = false;

  constructor(
    native: NativeAddon,
    kind: StreamKind,
    device: number | [number, number],
    channels: number | [number, number],
    dtype: string | [string, string],
    sampleRate: number,
    blockSize: number,
    latency: number | [number, number],
    flags: number,
    callback: StreamCallback | null,
    finishedCallback: StreamFinishedCallback | null,
  ) {
    this._native = native;
    this._kind = kind;
    this._callback = callback;
    this._finishedCallback = finishedCallback;

    const fmt = Array.isArray(dtype) ? dtype[0]! : dtype;
    this._fmtPa = sampleFormatToPa(fmt, native);
    const sampleSize = native.getSampleSize(this._fmtPa);
    if (kind === 'duplex') {
      this._sampleSize = [sampleSize, sampleSize];
    } else {
      this._sampleSize = sampleSize;
    }

    const dev = Array.isArray(device) ? device[0]! : device;
    const ch = Array.isArray(channels) ? channels[0]! : channels;
    const lat = Array.isArray(latency) ? latency[0]! : latency;
    const isInput = kind === 'input' || kind === 'duplex';
    const isOutput = kind === 'output' || kind === 'duplex';

    // Always open in blocking mode.
    // "Callback mode" is simulated by a JS-level polling loop.
    this._handle = native.openStream(
      dev,
      ch,
      this._fmtPa,
      sampleRate,
      lat,
      blockSize,
      flags,
      isInput,
      isOutput,
      false,
    );

    // Get actual stream info
    let info: { inputLatency: number; outputLatency: number; sampleRate: number };
    try {
      info = native.getStreamInfo(this._handle);
    } catch {
      info = { inputLatency: lat as number, outputLatency: lat as number, sampleRate };
    }

    this._sampleRate = info.sampleRate;
    this._blockSize = blockSize;
    this._channels = channels;
    this._dtype = dtype as SampleFormat | [SampleFormat, SampleFormat];
    this._device = device;

    if (kind === 'duplex') {
      this._latency = [info.inputLatency, info.outputLatency];
    } else {
      this._latency = kind === 'input' ? info.inputLatency : info.outputLatency;
    }
  }

  get sampleRate(): number { return this._sampleRate; }
  get blockSize(): number { return this._blockSize; }
  get channels(): number | [number, number] { return this._channels; }
  get dtype(): SampleFormat | [SampleFormat, SampleFormat] { return this._dtype; }
  get sampleSize(): number | [number, number] { return this._sampleSize; }
  get latency(): number | [number, number] { return this._latency; }
  get device(): number | string | [number | string, number | string] { return this._device; }

  get active(): boolean {
    if (this._closed) return false;
    try { return this._native.isStreamActive(this._handle); } catch { return false; }
  }

  get stopped(): boolean {
    if (this._closed) return true;
    try { return this._native.isStreamStopped(this._handle); } catch { return true; }
  }

  get closed(): boolean { return this._closed; }

  get time(): number {
    if (this._closed) return 0;
    try { return this._native.getStreamTime(this._handle); } catch { return 0; }
  }

  get cpuLoad(): number {
    if (this._closed) return 0;
    try { return this._native.getStreamCpuLoad(this._handle); } catch { return 0; }
  }

  start(): void {
    if (this._closed) throw new AudioError('Stream is closed');
    if (this._started) return;
    this._native.startStream(this._handle);
    this._started = true;

    // Register finished callback with PortAudio
    if (this._finishedCallback) {
      try {
        this._native.setStreamFinishedCallback(this._handle);
      } catch {
        // setStreamFinishedCallback is a no-op in Phase 2c
      }
    }

    // If a callback is provided, start the JS-level polling loop
    if (this._callback) {
      // Prime output buffers with silence to prevent initial underflow
      if (this._kind !== 'input') {
        const ch = Array.isArray(this._channels) ? this._channels[1]! : this._channels;
        const bs = this._blockSize || 256;
        const silence = new Float32Array(bs * (ch as number));
        try { this.write(silence); } catch { /* ignore */ }
        try { this.write(silence); } catch { /* ignore */ }
      }
      this._polling = true;
      this._pollLoop();

      // Poll for stream completion to trigger finished callback
      if (this._finishedCallback) {
        this._pollFinished();
      }
    }
  }

  /** Poll for stream completion (non-blocking streams) */
  private _pollFinished(): void {
    if (this._closed || !this._started) return;
    try {
      if (this._native.isStreamStopped(this._handle) && !this._native.isStreamActive(this._handle)) {
        this._finishedCallback?.();
        return;
      }
    } catch { /* ignore */ }
    setTimeout(() => this._pollFinished(), 100);
  }

  /**
   * JS-level polling loop that simulates PortAudio's callback mode.
   * Uses setImmediate to yield between iterations, keeping the event loop alive.
   */
  private _pollLoop(): void {
    if (!this._polling || this._closed) return;
    if (!this._callback) return;

    const ch = Array.isArray(this._channels) ? this._channels[0]! : this._channels;
    const blockSize = this._blockSize || 256;
    const isInput = this._kind === 'input' || this._kind === 'duplex';
    const isOutput = this._kind === 'output' || this._kind === 'duplex';
    const outCh = isOutput ? (Array.isArray(this._channels) ? this._channels[1]! : this._channels) : 0;

    try {
      // Determine how many frames to process this iteration
      let frames = blockSize;
      if (isInput && this.readAvailable < frames) frames = this.readAvailable;
      if (isOutput && this.writeAvailable < frames) frames = this.writeAvailable;
      if (frames <= 0) {
        // Not enough data available yet — try again soon
        setTimeout(() => this._pollLoop(), 0);
        return;
      }

      // Read input if needed
      let indata: Float32Array | null = null;
      if (isInput) {
        indata = this.read(frames);
      }

      // Prepare output buffer if needed
      let outdata: Float32Array | null = null;
      if (isOutput) {
        outdata = new Float32Array(frames * outCh);
      }

      // Build time info (approximate)
      const now = this.time;
      const streamTime: StreamTime = {
        inputBufferAdcTime: now,
        currentTime: now,
        outputBufferDacTime: now + frames / this._sampleRate,
      };

      // Call the user callback
      this._callback(indata, outdata, frames, streamTime, 0 as CallbackFlag);

      // Write output if needed
      if (isOutput && outdata) {
        this.write(outdata);
      }
    } catch (err) {
      if (err instanceof CallbackStop) {
        this._polling = false;
        this._finishedCallback?.();
        this.stop();
        return;
      }
      if (err instanceof CallbackAbort) {
        this._polling = false;
        this._finishedCallback?.();
        this.abort();
        return;
      }
      // Unknown error — stop polling and rethrow
      this._polling = false;
      throw err;
    }

    // Schedule next poll
    if (this._polling) {
      setTimeout(() => this._pollLoop(), 0);
    }
  }

  stop(): void {
    if (this._closed) return;
    this._polling = false;
    this._started = false;
    this._native.stopStream(this._handle);
  }

  abort(): void {
    if (this._closed) return;
    this._polling = false;
    this._started = false;
    this._native.abortStream(this._handle);
  }

  close(): void {
    if (this._closed) return;
    this._polling = false;
    this._started = false;
    this._native.closeStream(this._handle);
    this._closed = true;
  }

  get readAvailable(): number {
    if (this._closed) return 0;
    try { return this._native.getReadAvailable(this._handle); } catch { return 0; }
  }

  get writeAvailable(): number {
    if (this._closed) return 0;
    try { return this._native.getWriteAvailable(this._handle); } catch { return 0; }
  }

  read(frames: number): Float32Array {
    if (this._closed) throw new AudioError('Stream is closed');
    if (this._kind === 'output') throw new AudioError('Cannot read from an output-only stream');

    const raw = this._native.readStream(this._handle, frames);
    const channels = Array.isArray(this._channels) ? this._channels[0]! : this._channels;

    // Convert raw bytes to Float32Array based on sample format
    if (this._fmtPa === this._native.PA_FLOAT32) {
      return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    } else if (this._fmtPa === this._native.PA_INT16) {
      const out = new Float32Array(frames * channels);
      for (let i = 0; i < out.length; i++) {
        out[i] = raw.readInt16LE(i * 2) / 32768;
      }
      return out;
    } else if (this._fmtPa === this._native.PA_INT32) {
      const out = new Float32Array(frames * channels);
      for (let i = 0; i < out.length; i++) {
        out[i] = raw.readInt32LE(i * 4) / 2147483648;
      }
      return out;
    } else if (this._fmtPa === this._native.PA_INT8) {
      const out = new Float32Array(frames * channels);
      for (let i = 0; i < out.length; i++) {
        out[i] = raw.readInt8(i) / 128;
      }
      return out;
    } else if (this._fmtPa === this._native.PA_UINT8) {
      const out = new Float32Array(frames * channels);
      for (let i = 0; i < out.length; i++) {
        out[i] = (raw.readUInt8(i) - 128) / 128;
      }
      return out;
    } else if (this._fmtPa === this._native.PA_INT24) {
      // int24 = packed 3 bytes per sample, little-endian
      const out = new Float32Array(frames * channels);
      for (let i = 0; i < out.length; i++) {
        const b0 = raw.readUInt8(i * 3)!;
        const b1 = raw.readUInt8(i * 3 + 1)!;
        const b2 = raw.readUInt8(i * 3 + 2)!;
        // Sign-extend 24-bit to 32-bit
        let val = (b0 | (b1 << 8) | (b2 << 16));
        if (val & 0x800000) val |= 0xff000000;
        out[i] = val / 8388608; // 2^23
      }
      return out;
    }

    throw new AudioError(`Unsupported sample format for read: ${this._fmtPa}`);
  }

  write(buffer: Float32Array): void {
    if (this._closed) throw new AudioError('Stream is closed');
    if (this._kind === 'input') throw new AudioError('Cannot write to an input-only stream');

    // Convert Float32Array to raw bytes based on sample format
    let raw: Buffer;
    if (this._fmtPa === this._native.PA_FLOAT32) {
      raw = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else if (this._fmtPa === this._native.PA_INT16) {
      raw = Buffer.alloc(buffer.length * 2);
      for (let i = 0; i < buffer.length; i++) {
        raw.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buffer[i]!)) * 32767), i * 2);
      }
    } else if (this._fmtPa === this._native.PA_INT32) {
      raw = Buffer.alloc(buffer.length * 4);
      for (let i = 0; i < buffer.length; i++) {
        raw.writeInt32LE(Math.round(Math.max(-1, Math.min(1, buffer[i]!)) * 2147483647), i * 4);
      }
    } else if (this._fmtPa === this._native.PA_INT8) {
      raw = Buffer.alloc(buffer.length);
      for (let i = 0; i < buffer.length; i++) {
        raw.writeInt8(Math.round(Math.max(-1, Math.min(1, buffer[i]!)) * 127), i);
      }
    } else if (this._fmtPa === this._native.PA_UINT8) {
      raw = Buffer.alloc(buffer.length);
      for (let i = 0; i < buffer.length; i++) {
        raw.writeUInt8(Math.round((Math.max(-1, Math.min(1, buffer[i]!)) + 1) * 127.5), i);
      }
    } else if (this._fmtPa === this._native.PA_INT24) {
      raw = Buffer.alloc(buffer.length * 3);
      for (let i = 0; i < buffer.length; i++) {
        const sample = Math.max(-1, Math.min(1, buffer[i]!));
        const intVal = Math.round(sample * 8388607); // 2^23 - 1
        raw.writeUInt8(intVal & 0xff, i * 3);
        raw.writeUInt8((intVal >> 8) & 0xff, i * 3 + 1);
        raw.writeUInt8((intVal >> 16) & 0xff, i * 3 + 2);
      }
    } else {
      throw new AudioError(`Unsupported sample format for write: ${this._fmtPa}`);
    }

    try {
      this._native.writeStream(this._handle, raw);
    } catch (err) {
      // Output underflow is expected when stream hasn't started consuming yet
      if (err instanceof Error && !err.message.includes('Output underflowed')) {
        throw err;
      }
    }
  }
}

// ─── PortAudioBackend ─────────────────────────────

export class PortAudioBackend implements IBackend {
  private _native: NativeAddon | null = null;
  readonly devices: IDeviceManager;

  readonly capabilities: BackendCapabilities = {
    name: 'PortAudio',
    supportsInt24: true,
    supportsPlatformSettings: true,
    supportsCpuLoad: true,
    supportsHostAPIs: true,
    isRealtime: true,
  };

  constructor() {
    this.devices = new PortAudioDeviceManager();
  }

  private get native(): NativeAddon {
    if (!this._native) this._native = requireNative();
    return this._native;
  }

  /** 尝试预加载原生插件（返回 true 表示成功） */
  tryLoad(): boolean {
    const n = loadNative();
    if (n) {
      this._native = n;
      (this.devices as PortAudioDeviceManager)['_native'] = n;
      return true;
    }
    return false;
  }

  getVersion(): string {
    try { return String(this.native.getVersion()); } catch { return ''; }
  }

  getVersionText(): string {
    try { return this.native.getVersionText(); } catch { return ''; }
  }

  async sleep(msec: number): Promise<void> {
    try {
      this.native.sleep(msec);
    } catch {
      // Fallback to JS setTimeout if native not loaded
      await new Promise(resolve => setTimeout(resolve, msec));
    }
  }

  openStream(
    kind: StreamKind,
    options: StreamOptions | DuplexStreamOptions,
    callback?: StreamCallback | null,
    finishedCallback?: StreamFinishedCallback | null,
  ): IAudioStream {
    const n = this.native;

    // 解析参数 — 从 options 和 defaults 合并
    const isDuplex = kind === 'duplex';

    // 设备
    let dev: number | [number, number];
    if (isDuplex) {
      const dOpt = (options as DuplexStreamOptions).device;
      const [idef, odef] = splitPair(defaults.device);
      const [id, od] = dOpt
        ? splitPair(dOpt)
        : [idef, odef];
      dev = [
        id != null ? getDeviceId(n, id, 'input', true) : n.getDefaultInputDevice(),
        od != null ? getDeviceId(n, od, 'output', true) : n.getDefaultOutputDevice(),
      ];
    } else {
      const dOpt = (options as StreamOptions).device;
      const [idef, odef] = splitPair(defaults.device);
      const d = dOpt ?? (kind === 'input' ? idef : odef);
      dev = d != null ? getDeviceId(n, d, kind, true) : (
        kind === 'input' ? n.getDefaultInputDevice() : n.getDefaultOutputDevice()
      );
    }

    // 通道
    let channels: number | [number, number];
    if (isDuplex) {
      const chOpt = (options as DuplexStreamOptions).channels;
      const [idef, odef] = splitPair(defaults.channels);
      const [ich, och] = chOpt ? splitPair(chOpt) : [idef, odef];
      const devInfoIn = n.getDeviceInfo(Array.isArray(dev) ? dev[0]! : dev);
      const devInfoOut = n.getDeviceInfo(Array.isArray(dev) ? dev[1]! : dev);
      channels = [
        ich ?? devInfoIn.maxInputChannels,
        och ?? devInfoOut.maxOutputChannels,
      ];
    } else {
      const chOpt = (options as StreamOptions).channels;
      const [idef, odef] = splitPair(defaults.channels);
      const ch = chOpt ?? (kind === 'input' ? idef : odef);
      const devInfo = n.getDeviceInfo(Array.isArray(dev) ? dev[0]! : dev);
      channels = ch ?? (kind === 'input' ? devInfo.maxInputChannels : devInfo.maxOutputChannels);
    }

    // 样本格式
    let dtype: string | [string, string];
    if (isDuplex) {
      const dtOpt = (options as DuplexStreamOptions).dtype;
      const [idef, odef] = splitPair(defaults.dtype);
      dtype = dtOpt ? splitPair(dtOpt) : [idef, odef];
    } else {
      const dtOpt = (options as StreamOptions).dtype;
      const [idef, odef] = splitPair(defaults.dtype);
      dtype = dtOpt ?? (kind === 'input' ? idef : odef);
    }

    // 采样率
    const sampleRate: number = options.sampleRate ?? defaults.sampleRate ?? (() => {
      const d = Array.isArray(dev) ? dev[0]! : dev;
      return n.getDeviceInfo(d).defaultSampleRate;
    })();

    // 块大小
    const blockSize: number = options.blockSize ?? defaults.blockSize;

    // 延迟
    let latency: number | [number, number];
    if (isDuplex) {
      const latOpt = (options as DuplexStreamOptions).latency;
      const [idef, odef] = splitPair(defaults.latency);
      const [ilat, olat] = latOpt ? splitPair(latOpt) : [idef, odef];
      const devInfoIn = n.getDeviceInfo(Array.isArray(dev) ? dev[0]! : dev);
      const devInfoOut = n.getDeviceInfo(Array.isArray(dev) ? dev[1]! : dev);
      latency = [
        resolveLatency(ilat, devInfoIn, 'input'),
        resolveLatency(olat, devInfoOut, 'output'),
      ];
    } else {
      const latOpt = (options as StreamOptions).latency;
      const [idef, odef] = splitPair(defaults.latency);
      const lat = latOpt ?? (kind === 'input' ? idef : odef);
      const devInfo = n.getDeviceInfo(Array.isArray(dev) ? dev[0]! : dev);
      latency = resolveLatency(lat, devInfo, kind);
    }

    // 标志位
    const flags = computeFlags(
      n,
      options.clipOff ?? defaults.clipOff,
      options.ditherOff ?? defaults.ditherOff,
      options.neverDropInput ?? defaults.neverDropInput,
      options.primeOutputBuffersUsingStreamCallback ?? defaults.primeOutputBuffersUsingStreamCallback,
    );

    return new PortAudioStream(
      n, kind, dev, channels, dtype, sampleRate,
      blockSize, latency, flags,
      callback ?? null, finishedCallback ?? null,
    );
  }
}
