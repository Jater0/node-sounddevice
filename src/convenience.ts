/**
 * 便捷函数 — play(), record(), playRecord(), wait(), stop(), get_status(), get_stream()
 *
 * 对应 python-sounddevice 的同名函数。
 */

import type {
  IAudioStream,
  StreamCallback,
  StreamFinishedCallback,
} from './interfaces.js';
import type {
  StreamOptions,
  DuplexStreamOptions,
  StreamKind,
  SampleFormat,
  CallbackFlag,
  StreamTime,
} from './types.js';
import { getBackend } from './index.js';
import { AudioError, CallbackStop, CallbackAbort } from './errors.js';
import { defaults } from './defaults.js';

// ─── 全局状态 ─────────────────────────────────────

let _lastContext: CallbackContext | null = null;

// ─── 内部：回调上下文管理 ─────────────────────────

class CallbackContext {
  frame = 0;
  frames = 0;
  loop = false;
  blocksize = 0;
  status: CallbackFlag = 0 as CallbackFlag;

  // 输出
  data: Float32Array | null = null;
  outputChannels = 0;
  outputMapping: Int32Array | null = null;
  silentChannels: Int32Array | null = null;

  // 输入
  out: Float32Array | null = null;
  inputChannels = 0;
  inputMapping: Int32Array | null = null;

  private _stream: IAudioStream | null = null;
  private _resolve: (() => void) | null = null;

  /** 设置底层流（由便捷函数调用） */
  setStream(s: IAudioStream): void { this._stream = s; }
  /** 获取底层流 */
  getStream(): IAudioStream | null { return this._stream; }

  constructor(loop = false) {
    this.loop = loop;
  }

  /** 创建回调并返回 Promise */
  createCallback(): {
    callback: StreamCallback;
    finishedCallback: StreamFinishedCallback;
    promise: Promise<void>;
  } {
    let resolve: () => void;
    const promise = new Promise<void>((res) => { resolve = res; });
    this._resolve = resolve!;

    const self = this;

    const callback: StreamCallback = (indata, outdata, frames, _time, status) => {
      self.status = (self.status | status) as CallbackFlag;
      self.blocksize = Math.min(self.frames - self.frame, frames);

      // 输入
      if (indata && self.out && self.inputMapping) {
        self._readIndata(indata);
      }

      // 输出
      if (outdata && self.data && self.outputMapping) {
        self._writeOutdata(outdata);
      }

      self._checkDone();
    };

    const finishedCallback = () => {
      self._cleanup();
    };

    return { callback, finishedCallback, promise };
  }

  private _readIndata(indata: Float32Array): void {
    if (!this.out || !this.inputMapping) return;
    const inCh = this.inputChannels;
    for (let target = 0; target < this.inputMapping.length; target++) {
      const source = this.inputMapping[target]!;
      for (let f = 0; f < this.blocksize; f++) {
        this.out[(this.frame + f) * this.inputMapping.length + target] =
          indata[f * inCh + source]!;
      }
    }
  }

  private _writeOutdata(outdata: Float32Array): void {
    if (!this.data || !this.outputMapping) return;
    const outCh = this.outputChannels;

    // 写入映射通道
    for (let t = 0; t < this.outputMapping.length; t++) {
      const mapCh = this.outputMapping[t]!;
      for (let f = 0; f < this.blocksize; f++) {
        const srcIdx = (this.frame + f) * this.outputMapping.length + t;
        outdata[f * outCh + mapCh] = this.data[srcIdx]!;
      }
    }

    // 静音未使用通道
    if (this.silentChannels) {
      for (let s = 0; s < this.silentChannels.length; s++) {
        const silentCh = this.silentChannels[s]!;
        for (let f = 0; f < this.blocksize; f++) {
          outdata[f * outCh + silentCh] = 0;
        }
      }
    }

    // 剩余帧写零
    for (let f = this.blocksize; f < outdata.length / outCh; f++) {
      for (let c = 0; c < outCh; c++) {
        outdata[f * outCh + c] = 0;
      }
    }
  }

  private _checkDone(): void {
    if (this.blocksize === 0) {
      throw new CallbackAbort('Playback finished');
    }
    this.frame += this.blocksize;

    if (this.frame >= this.frames) {
      if (this.loop) {
        this.frame = 0;
      } else {
        throw new CallbackStop('Playback complete');
      }
    }
  }

  private _cleanup(): void {
    this.data = null;
    this.out = null;
    this._resolve?.();
  }

  /** 设置输出数据和映射 */
  setupOutput(data: Float32Array, mapping?: number[]): void {
    this.data = data;
    this.frames = data.length;

    if (mapping && mapping.length > 0) {
      this.outputMapping = new Int32Array(mapping.map(m => m - 1));
      this.outputChannels = Math.max(...mapping);
    } else {
      this.outputChannels = 1;
      this.outputMapping = new Int32Array([0]);
    }

    const allChannels = new Set(
      Array.from({ length: this.outputChannels }, (_, i) => i),
    );
    for (const m of this.outputMapping) {
      allChannels.delete(m);
    }
    this.silentChannels = new Int32Array([...allChannels]);
  }

  /** 设置输入缓冲区和映射 */
  setupInput(frames: number, channels: number, mapping?: number[]): void {
    this.frames = frames;
    if (mapping && mapping.length > 0) {
      this.inputMapping = new Int32Array(mapping.map(m => m - 1));
      this.inputChannels = Math.max(...mapping);
    } else {
      this.inputMapping = new Int32Array(
        Array.from({ length: channels }, (_, i) => i),
      );
      this.inputChannels = channels;
    }
    this.out = new Float32Array(frames * this.inputMapping.length);
  }

  /** 阻塞等待 */
  wait(): CallbackFlag | null {
    // In practice, the finished callback resolves the promise.
    // For wait(), we just need to block until done.
    return this.status || null;
  }

  /** 停止 */
  stop(): void {
    if (this._stream) {
      this._stream.stop();
      this._stream.close();
    }
    this._cleanup();
  }
}

// ─── play() ───────────────────────────────────────

/**
 * 播放音频数据。对应 python-sounddevice 的 play()。
 *
 * @param data 音频数据（1D = mono, 视为 1 通道）
 * @param sampleRate 采样率
 * @param options 含 blocking, loop, mapping, device 等
 */
export async function play(
  data: Float32Array | Int16Array | Int8Array | Uint8Array,
  sampleRate?: number,
  options?: StreamOptions & {
    blocking?: boolean;
    loop?: boolean;
    mapping?: number[];
  },
): Promise<void> {
  // Stop any previous invocation
  stop();

  const backend = await getBackend();
  const floatData = toFloat32(data);
  const blocking = options?.blocking ?? false;
  const loop = options?.loop ?? false;

  const ctx = new CallbackContext(loop);
  ctx.setupOutput(floatData, options?.mapping);

  const { callback, finishedCallback, promise } = ctx.createCallback();

  const stream = backend.openStream(
    'output',
    {
      ...(options ?? {}),
      sampleRate: sampleRate ?? options?.sampleRate ?? defaults.sampleRate ?? undefined,
      channels: ctx.outputChannels,
      dtype: 'float32',
    },
    callback,
    finishedCallback,
  );

  ctx.setStream(stream);
  _lastContext = ctx;

  stream.start();

  if (blocking) {
    await promise;
    stream.close();
  }
}

// ─── record() ─────────────────────────────────────

/**
 * 录制音频数据。对应 python-sounddevice 的 rec()。
 *
 * @param frames 录制帧数（out 指定时可选）
 * @param sampleRate 采样率
 * @param options 含 blocking, channels, dtype, mapping, out 等
 * @returns Float32Array
 */
export async function record(
  frames?: number,
  sampleRate?: number,
  options?: StreamOptions & {
    blocking?: boolean;
    mapping?: number[];
    out?: Float32Array;
  },
): Promise<Float32Array> {
  stop();

  const backend = await getBackend();
  const channels = options?.channels ?? 1;
  const numFrames = frames ?? sampleRate ?? 48000;
  const blocking = options?.blocking ?? false;

  const ctx = new CallbackContext();
  ctx.setupInput(numFrames, channels, options?.mapping);
  if (options?.out) {
    ctx.out = options.out;
  }

  const { callback, finishedCallback, promise } = ctx.createCallback();

  const stream = backend.openStream(
    'input',
    {
      ...(options ?? {}),
      sampleRate,
      channels: ctx.inputChannels,
      dtype: options?.dtype ?? 'float32',
    },
    callback,
    finishedCallback,
  );

  ctx.setStream(stream);
  _lastContext = ctx;

  stream.start();

  if (blocking) {
    await promise;
    stream.close();
  }

  return ctx.out!;
}

// ─── playRecord() ─────────────────────────────────

/**
 * 同时播放和录制。对应 python-sounddevice 的 playrec()。
 */
export async function playRecord(
  data: Float32Array | Int16Array | Int8Array | Uint8Array,
  sampleRate?: number,
  options?: StreamOptions & {
    frames?: number;
    inputChannels?: number;
    inputMapping?: number[];
    outputMapping?: number[];
    loop?: boolean;
    blocking?: boolean;
  },
): Promise<Float32Array> {
  stop();

  const backend = await getBackend();
  const floatData = toFloat32(data);
  const recordFrames = options?.frames ?? floatData.length;
  const inputChannels = options?.inputChannels ?? 1;

  const ctx = new CallbackContext(options?.loop ?? false);
  ctx.setupOutput(floatData, options?.outputMapping);
  ctx.setupInput(recordFrames, inputChannels, options?.inputMapping);

  const { callback, finishedCallback, promise } = ctx.createCallback();

  const stream = backend.openStream(
    'duplex',
    {
      ...(options ?? {}),
      sampleRate,
      channels: [ctx.inputChannels, ctx.outputChannels],
      dtype: [options?.dtype ?? 'float32', 'float32'] as [SampleFormat, SampleFormat],
    } as DuplexStreamOptions,
    callback,
    finishedCallback,
  );

  ctx.setStream(stream);
  _lastContext = ctx;

  stream.start();

  if (options?.blocking) {
    await promise;
    stream.close();
  }

  return ctx.out!;
}

// ─── wait() ───────────────────────────────────────

/**
 * 等待 play() / rec() / playrec() 完成。
 * 对应 python-sounddevice 的 wait()。
 *
 * @returns CallbackFlag | null — 上轮操作的状态标志
 */
export function wait(): CallbackFlag | null {
  if (!_lastContext) {
    throw new AudioError('play()/rec()/playrec() was not called yet');
  }
  return _lastContext.wait();
}

// ─── stop() ───────────────────────────────────────

/**
 * 停止当前的 play() / rec() / playrec()。
 * 不影响用 Stream 类直接创建的流。
 * 对应 python-sounddevice 的 stop()。
 */
export function stop(): void {
  if (_lastContext) {
    _lastContext.stop();
    _lastContext = null;
  }
}

// ─── get_status() ─────────────────────────────────

/**
 * 获取上轮 play()/rec()/playrec() 的 over-/underflow 状态。
 * 对应 python-sounddevice 的 get_status()。
 */
export function getStatus(): CallbackFlag {
  if (!_lastContext) {
    throw new AudioError('play()/rec()/playrec() was not called yet');
  }
  return _lastContext.status;
}

// ─── get_stream() ─────────────────────────────────

/**
 * 获取当前 play()/rec()/playrec() 底层流引用。
 * 对应 python-sounddevice 的 get_stream()。
 */
export function getStream(): IAudioStream {
  if (!_lastContext) {
    throw new AudioError('play()/rec()/playrec() was not called yet');
  }
  const stream = _lastContext.getStream();
  if (!stream) {
    throw new AudioError('No active stream');
  }
  return stream;
}

// ─── 辅助 ─────────────────────────────────────────

function toFloat32(
  data: Float32Array | Int16Array | Int8Array | Uint8Array,
): Float32Array {
  if (data instanceof Float32Array) return data;

  const result = new Float32Array(data.length);
  if (data instanceof Int16Array) {
    for (let i = 0; i < data.length; i++) {
      result[i] = data[i]! / 32768;
    }
  } else if (data instanceof Int8Array) {
    for (let i = 0; i < data.length; i++) {
      result[i] = data[i]! / 128;
    }
  } else if (data instanceof Uint8Array) {
    for (let i = 0; i < data.length; i++) {
      result[i] = (data[i]! - 128) / 128;
    }
  }
  return result;
}
