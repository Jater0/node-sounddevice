/**
 * 便捷函数 — play(), record(), playRecord()
 *
 * 对应 python-sounddevice 的同名函数。
 * 封装流生命周期管理，适合交互式使用和小脚本。
 */

import type {
  IAudioStream,
  StreamCallback,
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
import { defaults, splitPair } from './defaults.js';

// ─── 内部：回调上下文管理 ─────────────────────────

/**
 * 回调上下文 — 管理 play/rec/playrec 的状态机。
 * 对应 python-sounddevice 的 _CallbackContext。
 */
class CallbackContext {
  frame = 0;
  frames = 0;
  loop = false;
  blocksize = 0;

  // 输出相关
  data: Float32Array | null = null;
  outputChannels = 0;
  outputMapping: Int32Array | null = null;
  silentChannels: Int32Array | null = null;

  // 输入相关
  out: Float32Array | null = null;
  inputChannels = 0;
  inputMapping: Int32Array | null = null;

  private _stream: IAudioStream | null = null;
  private _resolve: (() => void) | null = null;
  private _reject: ((err: Error) => void) | null = null;
  private _status = 0;

  constructor(loop = false) {
    this.loop = loop;
  }

  /** 创建回调并返回 Promise */
  createCallback(): {
    callback: StreamCallback;
    finishedCallback: () => void;
    promise: Promise<void>;
  } {
    let resolve: () => void;
    let reject: (err: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this._resolve = resolve!;
    this._reject = reject!;

    const self = this;

    const callback: StreamCallback = (
      indata,
      outdata,
      frames,
      _time,
      status,
    ) => {
      self._status |= status;
      self.blocksize = Math.min(self.frames - self.frame, frames);

      // 输入：从 indata 读到 out buffer
      if (indata && self.out && self.inputMapping) {
        self._readIndata(indata, frames);
      }

      // 输出：从 data 写到 outdata
      if (outdata && self.data && self.outputMapping) {
        self._writeOutdata(outdata, frames);
      }

      self._checkDone();
    };

    const finishedCallback = () => {
      self._cleanup();
    };

    return { callback, finishedCallback, promise };
  }

  private _readIndata(indata: Float32Array, _frames: number): void {
    if (!this.out || !this.inputMapping) return;
    const channels = this.inputMapping.length;
    for (let target = 0; target < channels; target++) {
      const source = this.inputMapping[target]!;
      for (let f = 0; f < this.blocksize; f++) {
        this.out[(this.frame + f) * channels + target] =
          indata[f * this.inputChannels + source]!;
      }
    }
  }

  private _writeOutdata(outdata: Float32Array, _frames: number): void {
    if (!this.data || !this.outputMapping) return;

    // 写入映射通道
    const outChannels = this.outputChannels;
    for (let t = 0; t < this.outputMapping.length; t++) {
      const mapCh = this.outputMapping[t]!;
      for (let f = 0; f < this.blocksize; f++) {
        outdata[f * outChannels + mapCh] =
          this.data[(this.frame + f) * this.data.length / this.frames + t]!;
      }
    }

    // 静音未使用通道
    if (this.silentChannels) {
      for (let s = 0; s < this.silentChannels.length; s++) {
        const silentCh = this.silentChannels[s]!;
        for (let f = 0; f < this.blocksize; f++) {
          outdata[f * outChannels + silentCh] = 0;
        }
      }
    }

    // 剩余帧写零
    for (let f = this.blocksize; f < outdata.length / outChannels; f++) {
      for (let c = 0; c < outChannels; c++) {
        outdata[f * outChannels + c] = 0;
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

    // 推导通道数
    if (mapping && mapping.length > 0) {
      this.outputMapping = new Int32Array(mapping.map(m => m - 1));
      this.outputChannels = Math.max(...mapping);
    } else {
      this.outputChannels = 1;
      this.outputMapping = new Int32Array([0]);
    }

    // 计算静音通道
    const allChannels = new Set(
      Array.from({ length: this.outputChannels }, (_, i) => i),
    );
    for (const m of this.outputMapping) {
      allChannels.delete(m);
    }
    this.silentChannels = new Int32Array([...allChannels]);
  }

  /** 设置输入缓冲区 */
  setupInput(frames: number, channels: number): void {
    this.frames = frames;
    this.out = new Float32Array(frames * channels);
    this.inputChannels = channels;
    this.inputMapping = new Int32Array(
      Array.from({ length: channels }, (_, i) => i),
    );
  }
}

// ─── play() ───────────────────────────────────────

/**
 * 播放音频数据。
 *
 * 对应 python-sounddevice 的 play()。
 *
 * @param data 音频数据（1D = mono, 2D = 多通道，每列一个通道）
 * @param sampleRate 采样率（不传则用默认值）
 * @param options 额外流选项
 * @returns Promise，blocking=false 时立即 resolve，blocking=true 时等待播放完成
 *
 * @example
 * ```ts
 * // 生成 1 秒 440Hz 正弦波并播放
 * const sr = 48000;
 * const t = Array.from({ length: sr }, (_, i) => i / sr);
 * const data = new Float32Array(t.map(x => Math.sin(2 * Math.PI * 440 * x)));
 * await play(data, sr);
 * ```
 */
export async function play(
  data: Float32Array | Int16Array | Int8Array | Uint8Array,
  sampleRate?: number,
  options?: StreamOptions & { blocking?: boolean; loop?: boolean },
): Promise<void> {
  const backend = await getBackend();

  // 转换为 Float32
  const floatData = toFloat32(data);
  const blocking = options?.blocking ?? false;
  const loop = options?.loop ?? false;

  const ctx = new CallbackContext(loop);
  ctx.setupOutput(floatData, options?.device ? undefined : undefined);

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

  ctx['_stream'] = stream;
  stream.start();

  if (blocking) {
    return promise;
  } else {
    // 非阻塞模式：立即返回，流在后台播放
    promise.catch(() => { /* 静默处理 */ });
    return;
  }
}

// ─── record() ─────────────────────────────────────

/**
 * 录制音频数据。
 *
 * 对应 python-sounddevice 的 rec()。
 *
 * @param frames 录制帧数
 * @param sampleRate 采样率
 * @param options 额外流选项
 * @returns Float32Array，形状为 (frames, channels)
 *
 * @example
 * ```ts
 * // 录制 3 秒音频
 * const sr = 48000;
 * const data = await record(3 * sr, sr);
 * console.log('Recorded', data.length, 'samples');
 * ```
 */
export async function record(
  frames?: number,
  sampleRate?: number,
  options?: StreamOptions,
): Promise<Float32Array> {
  const backend = await getBackend();
  const numFrames = frames ?? sampleRate ?? 48000; // 默认 1 秒
  const channels = options?.channels ?? 1;

  const ctx = new CallbackContext();
  ctx.setupInput(numFrames, channels);

  const { callback, finishedCallback, promise } = ctx.createCallback();

  const stream = backend.openStream(
    'input',
    {
      ...(options ?? {}),
      sampleRate,
      channels,
      dtype: 'float32',
    },
    callback,
    finishedCallback,
  );

  ctx['_stream'] = stream;
  stream.start();

  await promise;
  stream.close();

  return ctx.out!;
}

// ─── playRecord() ─────────────────────────────────

/**
 * 同时播放和录制（全双工）。
 *
 * 对应 python-sounddevice 的 playrec()。
 *
 * @param data 要播放的音频数据
 * @param sampleRate 采样率
 * @param options 额外流选项
 * @returns Float32Array 录制的音频数据
 */
export async function playRecord(
  data: Float32Array | Int16Array | Int8Array | Uint8Array,
  sampleRate?: number,
  options?: DuplexOptions,
): Promise<Float32Array> {
  const backend = await getBackend();

  const floatData = toFloat32(data);
  const recordFrames = options?.frames ?? floatData.length;
  const inputChannels = options?.inputChannels ?? 1;

  const ctx = new CallbackContext(options?.loop ?? false);
  ctx.setupOutput(floatData);
  ctx.setupInput(recordFrames, inputChannels);

  const { callback, finishedCallback, promise } = ctx.createCallback();

  const stream = backend.openStream(
    'duplex',
    {
      sampleRate,
      channels: [inputChannels, ctx.outputChannels] as [number, number],
      dtype: ['float32', 'float32'] as [SampleFormat, SampleFormat],
      ...(options ?? {}),
    } as DuplexStreamOptions,
    callback,
    finishedCallback,
  );

  ctx['_stream'] = stream;
  stream.start();

  await promise;
  stream.close();

  return ctx.out!;
}

interface DuplexOptions extends StreamOptions {
  frames?: number;
  inputChannels?: number;
  loop?: boolean;
}

// ─── 辅助 ─────────────────────────────────────────

/**
 * 将各种整数格式转换为 Float32。
 */
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
