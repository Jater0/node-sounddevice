/**
 * 核心类型定义 — 平台无关的音频 API 类型
 * node-sounddevice
 */

// ─── 样本格式 ───────────────────────────────────────

/** PortAudio 支持的样本格式（Web 后端不支持 int24） */
export type SampleFormat =
  | 'float32'
  | 'int32'
  | 'int16'
  | 'int8'
  | 'uint8'
  | 'int24';

/** 样本格式对应的 TypedArray 类型映射 */
export type TypedArrayForFormat<T extends SampleFormat> =
  T extends 'float32' ? Float32Array
  : T extends 'int32' ? Int32Array
  : T extends 'int16' ? Int16Array
  : T extends 'int8' ? Int8Array
  : T extends 'uint8' ? Uint8Array
  : Int8Array; // int24 — 用 Int8Array 存放打包的 3 字节数据

// ─── 设备信息 ───────────────────────────────────────

/** 音频设备信息 */
export interface DeviceInfo {
  /** 设备唯一 ID（PortAudio 中是索引，Web 中是 deviceId 字符串） */
  id: number | string;
  /** 设备显示名称 */
  name: string;
  /** 所属宿主 API 的索引（Web 后端固定为 0） */
  hostAPI: number;
  /** 最大输入通道数 */
  maxInputChannels: number;
  /** 最大输出通道数 */
  maxOutputChannels: number;
  /** 默认低延迟（秒） */
  defaultLowInputLatency: number;
  /** 默认低延迟（秒） */
  defaultLowOutputLatency: number;
  /** 默认高延迟（秒） */
  defaultHighInputLatency: number;
  /** 默认高延迟（秒） */
  defaultHighOutputLatency: number;
  /** 默认采样率（Hz） */
  defaultSampleRate: number;
}

/** 宿主 API 信息 */
export interface HostAPIInfo {
  /** 宿主 API 索引 */
  id: number;
  /** 名称，如 "Core Audio", "WASAPI", "ALSA" */
  name: string;
  /** 该 API 下的设备数量 */
  deviceCount: number;
  /** 默认输入设备 ID */
  defaultInputDevice: number;
  /** 默认输出设备 ID */
  defaultOutputDevice: number;
}

// ─── 流参数 ───────────────────────────────────────

/** 流方向 */
export type StreamKind = 'input' | 'output' | 'duplex';

/** 延迟指定方式 */
export type LatencyHint = number | 'low' | 'high';

/** 流配置选项（打开流时传入） */
export interface StreamOptions {
  /** 采样率 Hz，不传则用设备默认值 */
  sampleRate?: number;
  /** 块大小（帧数），0 表示自动 */
  blockSize?: number;
  /** 设备 ID 或名称子串 */
  device?: number | string;
  /** 通道数 */
  channels?: number;
  /** 样本格式 */
  dtype?: SampleFormat;
  /** 延迟（秒或 'low'/'high'） */
  latency?: LatencyHint;
  /** 禁用削波 */
  clipOff?: boolean;
  /** 禁用抖动 */
  ditherOff?: boolean;
  /** 全双工时永不丢弃溢出输入 */
  neverDropInput?: boolean;
  /** 用回调填充初始输出缓冲区 */
  primeOutputBuffersUsingStreamCallback?: boolean;
}

/** 双向流的参数（输入/输出各自指定） */
export type DuplexStreamOptions = {
  sampleRate?: number;
  blockSize?: number;
  device?: [number | string, number | string];
  channels?: [number, number];
  dtype?: [SampleFormat, SampleFormat];
  latency?: [LatencyHint, LatencyHint];
} & Omit<StreamOptions, 'device' | 'channels' | 'dtype' | 'latency'>;

/** 回调函数的 status 标志位 */
export enum CallbackFlag {
  InputUnderflow  = 0x01,
  InputOverflow   = 0x02,
  OutputUnderflow = 0x04,
  OutputOverflow  = 0x08,
  PrimingOutput   = 0x10,
}

/** 流信息（运行时查询） */
export interface StreamInfo {
  /** 输入延迟（秒） */
  inputLatency: number;
  /** 输出延迟（秒） */
  outputLatency: number;
  /** 实际采样率（可能与请求的不同） */
  sampleRate: number;
}

/** 回调中的时间戳 */
export interface StreamTime {
  /** 输入 ADC 捕获时间 */
  inputBufferAdcTime: number;
  /** 当前流时间 */
  currentTime: number;
  /** 输出 DAC 时间 */
  outputBufferDacTime: number;
}

/** 后端能力声明 */
export interface BackendCapabilities {
  /** 后端名称 */
  name: string;
  /** 是否支持 int24 格式 */
  supportsInt24: boolean;
  /** 是否支持平台特定设置（AsioSettings 等） */
  supportsPlatformSettings: boolean;
  /** 是否支持 cpuLoad 查询 */
  supportsCpuLoad: boolean;
  /** 是否支持 hostAPI 查询 */
  supportsHostAPIs: boolean;
  /** 是否实时（原生后端）还是沙箱化（Web 后端） */
  isRealtime: boolean;
}
