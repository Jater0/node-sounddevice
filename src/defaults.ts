/**
 * 全局默认值管理 — node-sounddevice
 *
 * 对应 python-sounddevice 的 `default` 对象。
 * 在初始化后端之前就可以修改这些值。
 */

import type { SampleFormat, LatencyHint } from './types';

/** 输入/输出对 — 单个值表示两者相同，元组表示各自不同 */
export type InputOutputPair<T> = T | [T, T];

/** 将 InputOutputPair 拆成 [input, output] */
export function splitPair<T>(value: InputOutputPair<T>): [T, T] {
  if (Array.isArray(value) && value.length === 2) {
    return value as [T, T];
  }
  return [value as T, value as T];
}

/** 从 InputOutputPair 中根据 kind 选值 */
export function selectFromPair<T>(
  value: InputOutputPair<T>,
  kind: 'input' | 'output',
): T {
  const [ival, oval] = splitPair(value);
  return kind === 'input' ? ival : oval;
}

/**
 * 默认值容器。
 *
 * 用法：
 * ```ts
 * import { defaults } from 'node-sounddevice';
 * defaults.sampleRate = 48000;
 * defaults.channels = [1, 2];  // 输入 1 通道，输出 2 通道
 * defaults.device = 5;         // 输入输出都用设备 5
 * ```
 */
class Defaults {
  /** 默认采样率（null = 使用设备默认值） */
  sampleRate: number | null = null;

  /** 默认块大小（0 = 自动） */
  blockSize: number = 0;

  /** 默认设备（null = 使用系统默认） */
  device: InputOutputPair<number | string | null> = [null, null];

  /** 默认通道数（null = 使用设备最大值） */
  channels: InputOutputPair<number | null> = [null, null];

  /** 默认样本格式 */
  dtype: InputOutputPair<SampleFormat> = ['float32', 'float32'];

  /** 默认延迟 */
  latency: InputOutputPair<LatencyHint> = ['high', 'high'];

  /** 禁用削波 */
  clipOff: boolean = false;

  /** 禁用抖动 */
  ditherOff: boolean = false;

  /** 全双工时永不丢弃溢出输入 */
  neverDropInput: boolean = false;

  /** 用流回调填充初始输出缓冲区 */
  primeOutputBuffersUsingStreamCallback: boolean = false;

  /** 宿主 API 特定设置（平台相关，初始为 null） */
  extraSettings: InputOutputPair<unknown> = [null, null];

  /**
   * 重置所有值为出厂默认。
   */
  reset(): void {
    this.sampleRate = null;
    this.blockSize = 0;
    this.device = [null, null];
    this.channels = [null, null];
    this.dtype = ['float32', 'float32'];
    this.latency = ['high', 'high'];
    this.clipOff = false;
    this.ditherOff = false;
    this.neverDropInput = false;
    this.primeOutputBuffersUsingStreamCallback = false;
    this.extraSettings = [null, null];
  }
}

/** 全局默认值单例 */
export const defaults = new Defaults();
