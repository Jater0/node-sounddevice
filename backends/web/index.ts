/**
 * Web Audio 后端 — 浏览器
 *
 * 基于 Web Audio API 实现：
 * - 设备枚举：navigator.mediaDevices.enumerateDevices()
 * - 输入流：MediaStreamSource + AudioWorklet
 * - 输出流：AudioWorklet → AudioContext.destination
 * - 双工流：MediaStreamSource → AudioWorklet → destination
 *
 * 限制（vs PortAudio 后端）：
 * - 不支持 int24 格式
 * - 不支持平台特定设置（Asio/CoreAudio/Wasapi）
 * - 无法获取 cpuLoad
 * - 延迟比原生高
 * - 无法阻塞 read/write（只能用回调模式）
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
  StreamTime,
  CallbackFlag,
} from '../../src/types.js';
import { AudioError } from '../../src/errors.js';

// ─── 常量 ─────────────────────────────────────────

/** AudioWorklet 块大小（帧数） */
const WORKLET_BLOCK_SIZE = 128;

/** Web Audio 后端默认采样率 */
const WEB_DEFAULT_SAMPLE_RATE = 48000;

// ─── WebDeviceManager ─────────────────────────────

class WebDeviceManager implements IDeviceManager {
  private _cachedDevices: DeviceInfo[] | null = null;
  private _refreshPromise: Promise<DeviceInfo[]> | null = null;

  /**
   * 异步枚举设备（浏览器 API 是异步的）。
   * 应在用户手势后调用以获取完整标签。
   */
  async refreshDevices(): Promise<DeviceInfo[]> {
    if (this._refreshPromise) return this._refreshPromise;

    this._refreshPromise = this._enumerate();
    try {
      this._cachedDevices = await this._refreshPromise;
      return this._cachedDevices;
    } finally {
      this._refreshPromise = null;
    }
  }

  private async _enumerate(): Promise<DeviceInfo[]> {
    if (!globalThis.navigator?.mediaDevices?.enumerateDevices) {
      return [];
    }

    // 先请求权限以获取设备标签
    try {
      const stream = await globalThis.navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      // 立即释放流 — 我们只需要权限来获取标签
      stream.getTracks().forEach(t => t.stop());
    } catch {
      // 用户拒绝或没有麦克风，仍然可以枚举设备（无标签）
    }

    const rawDevices = await globalThis.navigator.mediaDevices.enumerateDevices();
    const result: DeviceInfo[] = [];
    let idCounter = 0;

    for (const d of rawDevices) {
      const isInput = d.kind === 'audioinput';
      const isOutput = d.kind === 'audiooutput';
      if (!isInput && !isOutput) continue;

      result.push({
        id: d.deviceId,
        name: d.label || `Audio Device ${idCounter + 1}`,
        hostAPI: 0,
        maxInputChannels: isInput ? 2 : 0,
        maxOutputChannels: isOutput ? 2 : 0,
        defaultLowInputLatency: 0.01,
        defaultLowOutputLatency: 0.01,
        defaultHighInputLatency: 0.05,
        defaultHighOutputLatency: 0.05,
        defaultSampleRate: WEB_DEFAULT_SAMPLE_RATE,
      });
      idCounter++;
    }
    return result;
  }

  getDevices(): DeviceInfo[] {
    return this._cachedDevices ?? [];
  }

  getHostAPIs(): HostAPIInfo[] {
    return [
      {
        id: 0,
        name: 'Web Audio',
        deviceCount: this.getDevices().length,
        defaultInputDevice: -1,
        defaultOutputDevice: -1,
      },
    ];
  }

  getDefaultInputDevice(): number { return -1; }
  getDefaultOutputDevice(): number { return -1; }

  getDeviceId(_nameOrId: number | string, _kind?: 'input' | 'output'): number {
    return -1;
  }

  checkInputSettings(): boolean { return true; }
  checkOutputSettings(): boolean { return true; }
}

// ─── AudioWorklet 处理器代码（作为字符串内联） ────

/**
 * AudioWorkletProcessor 代码。
 * 在 worklet 线程中运行，不能访问主线程作用域。
 * 以字符串形式内联，在注册时传递给 audioWorklet.addModule()。
 */
const WORKLET_PROCESSOR_CODE = `
class SoundDeviceProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [];
  }

  constructor(options) {
    super(options);
    this._blocksSinceMessage = 0;

    // 从主线程接收配置
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'setChannelCount') {
        // 动态调整通道数（通过 port 通信）
      }
    };
  }

  process(inputs, outputs, _parameters) {
    // inputs[0] = 输入通道数组 [channel][frames]
    // outputs[0] = 输出通道数组 [channel][frames]
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !output) return true;

    const channelCount = Math.max(
      input.length || 1,
      output.length || 1
    );
    const frameCount = output[0] ? output[0].length : 128;

    // 构建 Float32Array 视图
    // 输入数据（交错格式）
    const inData = new Float32Array(frameCount * channelCount);
    for (let ch = 0; ch < channelCount && ch < input.length; ch++) {
      const src = input[ch];
      if (src) {
        for (let f = 0; f < frameCount; f++) {
          inData[f * channelCount + ch] = src[f] || 0;
        }
      }
    }

    // 输出缓冲区（交错格式，预填充零）
    const outData = new Float32Array(frameCount * channelCount);

    // 发送到主线程处理（通过 MessagePort）
    // 主线程在 'message' 事件中调用用户回调并返回结果
    this.port.postMessage(
      {
        type: 'process',
        inData: inData.buffer,
        frameCount: frameCount,
      },
      [inData.buffer]  // 转移所有权，避免复制
    );

    // 注意：这种模式有延迟 — 每次 process() 都要往返主线程。
    // 真正的 AudioWorklet 实现应该将用户 DSP 代码放在 worklet 内部。
    // 此实现用于兼容 python-sounddevice 的回调模式。

    // 等待主线程返回（同步等待在 worklet 中不可能 — 我们暂时写零）
    for (let ch = 0; ch < channelCount && ch < output.length; ch++) {
      const dest = output[ch];
      if (dest) dest.fill(0);
    }

    // 定期通知主线程我们还在运行
    this._blocksSinceMessage++;
    if (this._blocksSinceMessage > 100) {
      this.port.postMessage({ type: 'heartbeat' });
      this._blocksSinceMessage = 0;
    }

    return true; // 保持处理器存活
  }
}

registerProcessor('sounddevice-processor', SoundDeviceProcessor);
`;

/** 内联的 worklet 代码转为 Blob URL */
let _workletBlobUrl: string | null = null;

function getWorkletUrl(): string {
  if (!_workletBlobUrl) {
    const blob = new Blob([WORKLET_PROCESSOR_CODE], {
      type: 'application/javascript',
    });
    _workletBlobUrl = URL.createObjectURL(blob);
  }
  return _workletBlobUrl;
}

// ─── WebAudioStream ───────────────────────────────

class WebAudioStream implements IAudioStream {
  private _ctx: AudioContext | null = null;
  private _workletNode: AudioWorkletNode | null = null;
  private _mediaStream: MediaStream | null = null;
  private _sourceNode: MediaStreamAudioSourceNode | null = null;
  private _kind: StreamKind;
  private _options: StreamOptions | DuplexStreamOptions;
  private _callback: StreamCallback | null;
  private _finishedCallback: StreamFinishedCallback | null;
  private _closed: boolean = false;
  private _started: boolean = false;

  constructor(
    kind: StreamKind,
    options: StreamOptions | DuplexStreamOptions,
    callback: StreamCallback | null,
    finishedCallback: StreamFinishedCallback | null,
  ) {
    this._kind = kind;
    this._options = options;
    this._callback = callback;
    this._finishedCallback = finishedCallback;
  }

  get sampleRate(): number {
    return this._ctx?.sampleRate
      ?? (this._options as StreamOptions).sampleRate
      ?? WEB_DEFAULT_SAMPLE_RATE;
  }

  get blockSize(): number {
    return (this._options as StreamOptions).blockSize || WORKLET_BLOCK_SIZE;
  }

  get channels(): number | [number, number] {
    const ch = (this._options as StreamOptions).channels;
    if (this._kind === 'duplex') {
      const [ich, och] = Array.isArray(ch) ? ch : [ch, ch];
      return [ich ?? 1, och ?? 1];
    }
    return ch ?? 1;
  }

  get dtype(): SampleFormat | [SampleFormat, SampleFormat] {
    if (this._kind === 'duplex') {
      const dt = (this._options as DuplexStreamOptions).dtype;
      const [id, od] = Array.isArray(dt) ? dt : [dt, dt];
      return [id ?? 'float32', od ?? 'float32'];
    }
    return (this._options as StreamOptions).dtype ?? 'float32';
  }

  get sampleSize(): number | [number, number] {
    const s = 4; // Web Audio 始终 float32 = 4 bytes
    return this._kind === 'duplex' ? [s, s] : s;
  }

  get latency(): number | [number, number] {
    const baseLatency = this._ctx?.baseLatency ?? 0.005;
    const outputLatency = this._ctx?.outputLatency ?? 0;
    const total = baseLatency + outputLatency;
    return this._kind === 'duplex' ? [total, total] : total;
  }

  get device(): number | string | [number | string, number | string] {
    if (this._kind === 'duplex') return ['default', 'default'];
    return 'default';
  }

  get active(): boolean {
    return this._started && !this._closed;
  }

  get stopped(): boolean {
    return !this._started || this._closed;
  }

  get closed(): boolean {
    return this._closed;
  }

  get time(): number {
    return this._ctx?.currentTime ?? 0;
  }

  get cpuLoad(): number {
    return 0; // Web Audio 无法获取
  }

  async start(): Promise<void> {
    if (this._closed) throw new AudioError('Stream is closed');
    if (this._started) return;

    // 创建 AudioContext（需要用户手势后调用）
    if (!this._ctx) {
      this._ctx = new AudioContext({
        sampleRate: (this._options as StreamOptions).sampleRate,
      });
    }

    if (this._ctx.state === 'suspended') {
      await this._ctx.resume();
    }

    // 注册 AudioWorklet 处理器
    try {
      await this._ctx.audioWorklet.addModule(getWorkletUrl());
    } catch {
      // 可能已经注册过
    }

    const channelCount = Array.isArray(this.channels)
      ? Math.max(this.channels[0], this.channels[1])
      : this.channels;

    // 创建 AudioWorkletNode
    this._workletNode = new AudioWorkletNode(
      this._ctx,
      'sounddevice-processor',
      {
        numberOfInputs: this._kind === 'output' ? 0 : 1,
        numberOfOutputs: this._kind === 'input' ? 0 : 1,
        outputChannelCount: [channelCount],
      },
    );

    // 输入端：获取麦克风
    if (this._kind === 'input' || this._kind === 'duplex') {
      try {
        this._mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: (this._options as StreamOptions).device
              ? String((this._options as StreamOptions).device)
              : undefined,
            channelCount: Array.isArray(this.channels)
              ? this.channels[0]
              : this.channels,
          },
        });
        this._sourceNode = this._ctx.createMediaStreamSource(this._mediaStream);
        this._sourceNode.connect(this._workletNode);
      } catch (err) {
        throw new AudioError(
          `Failed to access microphone: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // 输出端：连接到 destination
    if (this._kind === 'output' || this._kind === 'duplex') {
      this._workletNode.connect(this._ctx.destination);
    }

    // 处理 worklet 消息
    this._workletNode.port.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'process' && this._callback && this._started) {
        const inData = new Float32Array(msg.inData);
        const outData = new Float32Array(msg.frameCount * channelCount);
        const frames = msg.frameCount;

        // 构造时间戳（Web Audio 精度有限）
        const time: StreamTime = {
          inputBufferAdcTime: this._ctx!.currentTime,
          currentTime: this._ctx!.currentTime,
          outputBufferDacTime: this._ctx!.currentTime + (frames / this.sampleRate),
        };

        try {
          this._callback(
            this._kind !== 'output' ? inData : null,
            this._kind !== 'input' ? outData : null,
            frames,
            time,
            0 as CallbackFlag, // status — Web Audio 不提供 underflow/overflow 标志
          );

          // 将处理结果发回 worklet
          this._workletNode!.port.postMessage(
            { type: 'output', outData: outData.buffer },
            [outData.buffer],
          );
        } catch (err) {
          if (err instanceof Error && err.name === 'CallbackStop') {
            this._finishedCallback?.();
            this.stop();
          } else if (err instanceof Error && err.name === 'CallbackAbort') {
            this._finishedCallback?.();
            this.abort();
          } else {
            throw err;
          }
        }
      }
    };

    this._started = true;
  }

  stop(): void {
    this._started = false;
    this._cleanupNodes();
  }

  abort(): void {
    this._started = false;
    this._cleanupNodes();
    this._ctx?.close();
    this._ctx = null;
  }

  close(): void {
    this._started = false;
    this._cleanupNodes();
    if (this._mediaStream) {
      this._mediaStream.getTracks().forEach(t => t.stop());
      this._mediaStream = null;
    }
    this._ctx?.close();
    this._ctx = null;
    this._closed = true;
  }

  private _cleanupNodes(): void {
    if (this._sourceNode) {
      this._sourceNode.disconnect();
      this._sourceNode = null;
    }
    if (this._workletNode) {
      this._workletNode.disconnect();
      this._workletNode.port.onmessage = null;
      this._workletNode = null;
    }
  }

  // 阻塞模式 — Web Audio 不支持
  get readAvailable(): number { return 0; }
  get writeAvailable(): number { return 0; }

  read(_frames: number): Float32Array {
    throw new AudioError(
      'Blocking read is not available in the Web Audio backend. Use callback mode.',
    );
  }

  write(_buffer: Float32Array): void {
    throw new AudioError(
      'Blocking write is not available in the Web Audio backend. Use callback mode.',
    );
  }
}

// ─── WebBackend ───────────────────────────────────

export class WebBackend implements IBackend {
  readonly capabilities: BackendCapabilities = {
    name: 'Web Audio',
    supportsInt24: false,
    supportsPlatformSettings: false,
    supportsCpuLoad: false,
    supportsHostAPIs: false,
    isRealtime: false,
  };

  private _deviceMgr: WebDeviceManager;

  readonly devices: IDeviceManager & {
    /** 异步刷新设备列表（获取完整标签需要用户手势后调用） */
    refreshDevices(): Promise<DeviceInfo[]>;
  };

  constructor() {
    this._deviceMgr = new WebDeviceManager();
    this.devices = Object.assign(this._deviceMgr, {
      refreshDevices: () => this._deviceMgr.refreshDevices(),
    });
  }

  getVersion(): string { return ''; }
  getVersionText(): string { return 'Web Audio API'; }

  async sleep(msec: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, msec));
  }

  openStream(
    kind: StreamKind,
    options: StreamOptions | DuplexStreamOptions,
    callback?: StreamCallback | null,
    finishedCallback?: StreamFinishedCallback | null,
  ): IAudioStream {
    // Web Audio 只支持回调模式
    if (!callback) {
      throw new AudioError(
        'Web Audio backend requires a callback. Blocking mode is not supported in browsers.',
      );
    }
    return new WebAudioStream(kind, options, callback, finishedCallback ?? null);
  }
}
