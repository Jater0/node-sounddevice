/**
 * 抽象接口 — 平台无关的音频后端契约
 * node-sounddevice
 */

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

// ─── 流回调 ────────────────────────────────────────

/**
 * 流回调签名。
 * 对 input 流：outdata 为 null
 * 对 output 流：indata 为 null
 * 对 duplex 流：两者都非 null
 */
export type StreamCallback = (
  indata: Float32Array | null,
  outdata: Float32Array | null,
  frames: number,
  time: StreamTime,
  status: CallbackFlag,
) => void;

/** finished_callback：流播放完毕时调用 */
export type StreamFinishedCallback = () => void;

// ─── IAudioStream ──────────────────────────────────

/**
 * 音频流接口。
 * 支持两种使用模式：
 * 1. 回调模式 — 传入 callback，流自动推/拉数据
 * 2. 阻塞模式 — 不传 callback，手动 read()/write()
 */
export interface IAudioStream {
  /** 实际采样率（可能与请求不同） */
  readonly sampleRate: number;
  /** 块大小（0 表示可变） */
  readonly blockSize: number;
  /** 输入/输出通道数 */
  readonly channels: number | [number, number];
  /** 样本格式 */
  readonly dtype: SampleFormat | [SampleFormat, SampleFormat];
  /** 每个样本的字节数 */
  readonly sampleSize: number | [number, number];
  /** 输入/输出延迟（秒） */
  readonly latency: number | [number, number];
  /** 设备 ID */
  readonly device: number | string | [number | string, number | string];
  /** 流是否活跃（已 start 且未 stop） */
  readonly active: boolean;
  /** 流是否已停止 */
  readonly stopped: boolean;
  /** 流是否已关闭 */
  readonly closed: boolean;
  /** 当前流时间（秒） */
  readonly time: number;
  /** CPU 负载（0.0~1.0，阻塞流返回 0） */
  readonly cpuLoad: number;

  /** 开始播放/录制 */
  start(): void;
  /** 停止（等待缓冲区播放完） */
  stop(): void;
  /** 立即中止（丢弃待播缓冲区） */
  abort(): void;
  /** 关闭流，释放资源 */
  close(): void;

  // ── 阻塞模式 ──────────────────────────────────

  /** 可读帧数（不阻塞） */
  readonly readAvailable: number;
  /** 可写帧数（不阻塞） */
  readonly writeAvailable: number;

  /**
   * 读取音频数据（阻塞直到足够的帧可用）。
   * @param frames 请求帧数
   * @returns Float32Array 长度为 frames * channels
   */
  read(frames: number): Float32Array;

  /**
   * 写入音频数据（阻塞直到有空间）。
   * @param buffer 音频数据，长度必须是 frames * channels
   */
  write(buffer: Float32Array): void;
}

// ─── IDeviceManager ─────────────────────────────────

/**
 * 设备管理器接口。
 */
export interface IDeviceManager {
  /** 获取所有可用设备 */
  getDevices(): DeviceInfo[];

  /** 获取所有宿主 API */
  getHostAPIs(): HostAPIInfo[];

  /** 获取默认输入设备 ID */
  getDefaultInputDevice(): number;

  /** 获取默认输出设备 ID */
  getDefaultOutputDevice(): number;

  /** 根据名称子串或 ID 查找设备 */
  getDeviceId(nameOrId: number | string, kind?: 'input' | 'output'): number;

  /** 检查输入设置是否支持 */
  checkInputSettings(
    device?: number,
    channels?: number,
    sampleRate?: number,
    dtype?: SampleFormat,
    latency?: number,
  ): boolean;

  /** 检查输出设置是否支持 */
  checkOutputSettings(
    device?: number,
    channels?: number,
    sampleRate?: number,
    dtype?: SampleFormat,
    latency?: number,
  ): boolean;
}

// ─── IBackend ──────────────────────────────────────

/**
 * 后端接口。
 * 每个平台（PortAudio / Web Audio）实现此接口。
 */
export interface IBackend {
  /** 后端能力 */
  readonly capabilities: BackendCapabilities;

  /** 设备管理器 */
  readonly devices: IDeviceManager;

  /** 获取 PortAudio 版本（Web 后端返回空字符串） */
  getVersion(): string;

  /** 获取 PortAudio 版本文本（Web 后端返回空字符串） */
  getVersionText(): string;

  /** 休眠（毫秒），Web 后端用 setTimeout 实现 */
  sleep(msec: number): Promise<void>;

  /**
   * 打开一个音频流。
   *
   * 回调模式：传入 callback，流自动推/拉数据。
   * 阻塞模式：不传 callback，手动 IAudioStream.read()/write()。
   *
   * @param kind 流方向
   * @param options 流选项（duplex 需用 DuplexStreamOptions）
   * @param callback 可选回调
   * @param finishedCallback 可选完成回调
   */
  openStream(
    kind: StreamKind,
    options: StreamOptions | DuplexStreamOptions,
    callback?: StreamCallback | null,
    finishedCallback?: StreamFinishedCallback | null,
  ): IAudioStream;
}
