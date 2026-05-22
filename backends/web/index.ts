/**
 * Web Audio 后端 — 浏览器
 *
 * 基于 Web Audio API + SharedArrayBuffer + AudioWorklet 实现。
 *
 * 数据回路：
 * - 输出流：主线程 (rAF 轮询) 填充 ring buffer → worklet process() 读出
 * - 输入流：worklet process() 写入 ring buffer → 主线程 (rAF 轮询) 读出
 * - 双工流：两个独立 ring buffer
 *
 * SharedArrayBuffer 结构（每个方向一块，blockSize 帧 × channels × 4 bytes）：
 *   [0..3]     sequence: Int32 — 生产者的写入序号
 *   [4..7]     consumed: Int32 — 消费者的读取序号
 *   [8..]      data: Float32Array — 音频数据
 *
 * 限制：
 * - 需要 SharedArrayBuffer（需 COOP/COEP 头 或 同源）
 * - 不支持 int24
 * - 不支持阻塞 read/write
 * - 不支持平台特定设置
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
import { AudioError, CallbackStop, CallbackAbort } from '../../src/errors.js';

// ─── SharedArrayBuffer Ring Buffer ────────────────

const HEADER_SIZE = 8; // writePos (4) + readPos (4)
const RING_CAPACITY_FRAMES = 8192; // ~170ms at 48kHz

class RingBuffer {
  readonly sab: SharedArrayBuffer;
  readonly data: Float32Array;
  readonly channels: number;
  readonly capacity: number;
  private _wp: Int32Array;
  private _rp: Int32Array;

  constructor(channels: number) {
    this.channels = channels;
    this.capacity = RING_CAPACITY_FRAMES;
    const dataLen = this.capacity * channels;
    this.sab = new SharedArrayBuffer(HEADER_SIZE + dataLen * 4);
    this._wp = new Int32Array(this.sab, 0, 1);
    this._rp = new Int32Array(this.sab, 4, 1);
    this.data = new Float32Array(this.sab, HEADER_SIZE, dataLen);
  }

  available(): number {
    const w = Atomics.load(this._wp, 0);
    const r = Atomics.load(this._rp, 0);
    return (w - r + this.capacity) % this.capacity;
  }

  writable(): number {
    return this.capacity - this.available() - 1;
  }

  produce(src: Float32Array, frames: number): number {
    const w = Atomics.load(this._wp, 0);
    const free = this.capacity - this.available() - 1;
    const n = Math.min(frames, free);
    if (n <= 0) return 0;
    const ch = this.channels;
    for (let i = 0; i < n; i++) {
      const wi = ((w + i) % this.capacity) * ch;
      for (let c = 0; c < ch; c++) this.data[wi + c] = src[i * ch + c]!;
    }
    Atomics.store(this._wp, 0, (w + n) % this.capacity);
    Atomics.notify(this._wp, 0, 1);
    return n;
  }

  consume(dest: Float32Array, frames: number): number {
    const avail = this.available();
    const n = Math.min(frames, avail);
    if (n <= 0) return 0;
    const r = Atomics.load(this._rp, 0);
    const ch = this.channels;
    for (let i = 0; i < n; i++) {
      const ri = ((r + i) % this.capacity) * ch;
      for (let c = 0; c < ch; c++) dest[i * ch + c] = this.data[ri + c]!;
    }
    Atomics.store(this._rp, 0, (r + n) % this.capacity);
    return n;
  }

  hasNewData(): boolean { return this.available() > 0; }
}

// ─── WebDeviceManager ─────────────────────────────

class WebDeviceManager implements IDeviceManager {
  private _cachedDevices: DeviceInfo[] | null = null;

  async refreshDevices(): Promise<DeviceInfo[]> {
    this._cachedDevices = await this._enumerate();
    return this._cachedDevices;
  }

  private async _enumerate(): Promise<DeviceInfo[]> {
    if (!globalThis.navigator?.mediaDevices?.enumerateDevices) return [];

    try {
      const stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch { /* no mic permission, still enumerate */ }

    const rawDevices = await globalThis.navigator.mediaDevices.enumerateDevices();
    const result: DeviceInfo[] = [];
    let idCounter = 0;

    for (const d of rawDevices) {
      if (d.kind !== 'audioinput' && d.kind !== 'audiooutput') continue;
      result.push({
        id: d.deviceId,
        name: d.label || `Audio Device ${idCounter + 1}`,
        hostAPI: 0,
        maxInputChannels: d.kind === 'audioinput' ? 2 : 0,
        maxOutputChannels: d.kind === 'audiooutput' ? 2 : 0,
        defaultLowInputLatency: 0.01,
        defaultLowOutputLatency: 0.01,
        defaultHighInputLatency: 0.05,
        defaultHighOutputLatency: 0.05,
        defaultSampleRate: 48000,
      });
      idCounter++;
    }
    return result;
  }

  getDevices(): DeviceInfo[] { return this._cachedDevices ?? []; }
  getHostAPIs(): HostAPIInfo[] {
    return [{ id: 0, name: 'Web Audio', deviceCount: this.getDevices().length, defaultInputDevice: -1, defaultOutputDevice: -1 }];
  }
  getDefaultInputDevice(): number { return -1; }
  getDefaultOutputDevice(): number { return -1; }
  getDeviceId(): number { return -1; }
  checkInputSettings(): boolean { return true; }
  checkOutputSettings(): boolean { return true; }
}

// ─── AudioWorklet Processor Code ──────────────────

const WORKLET_CODE = `
const CAP = 8192;
class SoundDeviceProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return []; }

  constructor(opts) {
    super(opts);
    this._ib = null; this._ob = null;
    this._ch = 1; this._in = false; this._out = false;
    this.port.onmessage = (e) => {
      if (e.data.type === 'init') {
        this._in = e.data.isInput; this._out = e.data.isOutput;
        this._ch = e.data.channels;
        if (e.data.ib) this._ib = e.data.ib;
        if (e.data.ob) this._ob = e.data.ob;
        this.port.postMessage({ type: 'ready' });
      }
    };
  }

  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    try {
      // Write input to ring buffer
      if (this._in && inp && inp[0] && this._ib) {
        const wp = new Int32Array(this._ib, 0, 1);
        const rp = new Int32Array(this._ib, 4, 1);
        const dat = new Float32Array(this._ib, 8);
        const w = Atomics.load(wp, 0);
        const r = Atomics.load(rp, 0);
        const avail = (w - r + CAP) % CAP;
        const free = CAP - avail - 1;
        const fc = Math.min(free, inp[0].length);
        for (let f = 0; f < fc; f++) {
          const wi = ((w + f) % CAP) * this._ch;
          for (let c = 0; c < this._ch && c < inp.length; c++) {
            dat[wi + c] = (inp[c] && inp[c][f]) || 0;
          }
        }
        Atomics.store(wp, 0, (w + fc) % CAP);
      }
      // Read output from ring buffer
      if (this._out && out && out[0] && this._ob) {
        const wp = new Int32Array(this._ob, 0, 1);
        const rp = new Int32Array(this._ob, 4, 1);
        const dat = new Float32Array(this._ob, 8);
        const w = Atomics.load(wp, 0);
        const r = Atomics.load(rp, 0);
        const avail = (w - r + CAP) % CAP;
        const fc = Math.min(avail, out[0].length);
        for (let f = 0; f < fc; f++) {
          const ri = ((r + f) % CAP) * this._ch;
          for (let c = 0; c < this._ch && c < out.length; c++) {
            if (out[c]) out[c][f] = dat[ri + c] || 0;
          }
        }
        Atomics.store(rp, 0, (r + fc) % CAP);
      } else if (this._out && out) {
        for (let c = 0; c < out.length; c++) if (out[c]) out[c].fill(0);
      }
    } catch (_) {}
    return true;
  }
}

registerProcessor('sounddevice-processor', SoundDeviceProcessor);
`;

let _workletBlobUrl: string | null = null;
function getWorkletUrl(): string {
  if (!_workletBlobUrl) {
    _workletBlobUrl = URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'application/javascript' }));
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
  private _opts: StreamOptions | DuplexStreamOptions;
  private _callback: StreamCallback | null;
  private _finishedCallback: StreamFinishedCallback | null;
  private _closed = false;
  private _started = false;
  private _polling = false;

  // SharedArrayBuffer ring buffers
  private _inputRb: RingBuffer | null = null;
  private _outputRb: RingBuffer | null = null;
  private _sampleRate: number;
  private _blockSize: number;
  private _channels: number | [number, number];
  private _inputChannels: number;
  private _outputChannels: number;

  constructor(
    kind: StreamKind,
    options: StreamOptions | DuplexStreamOptions,
    callback: StreamCallback | null,
    finishedCallback: StreamFinishedCallback | null,
  ) {
    this._kind = kind;
    this._opts = options;
    this._callback = callback;
    this._finishedCallback = finishedCallback;

    const ch = (options as StreamOptions).channels ?? 1;
    if (kind === 'duplex') {
      const [ich, och] = Array.isArray(ch) ? ch : [ch, ch];
      this._inputChannels = ich;
      this._outputChannels = och;
      this._channels = [ich, och];
    } else {
      this._inputChannels = kind === 'input' ? ch : 0;
      this._outputChannels = kind === 'output' ? ch : 0;
      this._channels = ch;
    }

    this._sampleRate = (options as StreamOptions).sampleRate ?? 48000;
    this._blockSize = (options as StreamOptions).blockSize || 128;
  }

  get sampleRate(): number { return this._ctx?.sampleRate ?? this._sampleRate; }
  get blockSize(): number { return this._blockSize; }
  get channels(): number | [number, number] { return this._channels; }
  get dtype(): SampleFormat | [SampleFormat, SampleFormat] { return 'float32'; }
  get sampleSize(): number | [number, number] { return 4; }
  get latency(): number | [number, number] {
    const base = (this._ctx?.baseLatency ?? 0.005) + (this._ctx?.outputLatency ?? 0);
    return this._kind === 'duplex' ? [base, base] : base;
  }
  get device(): number | string | [number | string, number | string] { return 'default'; }
  get active(): boolean { return this._started && !this._closed; }
  get stopped(): boolean { return !this._started || this._closed; }
  get closed(): boolean { return this._closed; }
  get time(): number { return this._ctx?.currentTime ?? 0; }
  get cpuLoad(): number { return 0; }

  async start(): Promise<void> {
    if (this._closed) throw new AudioError('Stream is closed');
    if (this._started) return;

    this._ctx = new AudioContext({ sampleRate: this._sampleRate });
    if (this._ctx.state === 'suspended') await this._ctx.resume();

    // Create SharedArrayBuffer ring buffers
    const maxCh = Math.max(this._inputChannels, this._outputChannels);
    if (this._outputChannels > 0) {
      this._outputRb = new RingBuffer(this._outputChannels);
    }
    if (this._inputChannels > 0) {
      this._inputRb = new RingBuffer(this._inputChannels);
    }

    // Register worklet
    try { await this._ctx.audioWorklet.addModule(getWorkletUrl()); } catch { /* already registered */ }

    // Create worklet node
    this._workletNode = new AudioWorkletNode(this._ctx, 'sounddevice-processor', {
      numberOfInputs: this._kind === 'output' ? 0 : 1,
      numberOfOutputs: this._kind === 'input' ? 0 : 1,
      outputChannelCount: [maxCh],
    });

    // Send ring buffers to worklet
    this._workletNode.port.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'ready') {
        // Worklet initialized — start polling if callback mode
        if (this._callback) {
          this._polling = true;
          this._pollLoop();
        }
      }
    };

    this._workletNode.port.postMessage({
      type: 'init',
      isInput: this._kind === 'input' || this._kind === 'duplex',
      isOutput: this._kind === 'output' || this._kind === 'duplex',
      channels: maxCh,
      blockSize: this._blockSize,
      inputBuffer: this._inputRb?.sab,
      outputBuffer: this._outputRb?.sab,
    }, this._inputRb ? [this._inputRb.sab] : []);

    // Get microphone if needed
    if (this._kind === 'input' || this._kind === 'duplex') {
      try {
        this._mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: this._inputChannels || 1 },
        });
        this._sourceNode = this._ctx.createMediaStreamSource(this._mediaStream);
        this._sourceNode.connect(this._workletNode);
      } catch (err) {
        throw new AudioError(`Microphone access denied: ${err}`);
      }
    }

    // Connect to speakers if output
    if (this._kind === 'output' || this._kind === 'duplex') {
      this._workletNode.connect(this._ctx.destination);
    }

    this._started = true;
  }

  private _pollLoop(): void {
    if (!this._polling || this._closed || !this._callback) return;

    try {
      const isIn = this._kind === 'input' || this._kind === 'duplex';
      const isOut = this._kind === 'output' || this._kind === 'duplex';

      // Fill multiple blocks per tick to avoid underruns
      let count = 0;
      const maxBlocks = 4;
      while (count < maxBlocks) {
        let indata: Float32Array | null = null;
        let outdata: Float32Array | null = null;

        if (isIn && this._inputRb && this._inputRb.hasNewData()) {
          indata = new Float32Array(this._blockSize * this._inputChannels);
          this._inputRb.consume(indata, this._blockSize);
        }

        if (isOut) {
          outdata = new Float32Array(this._blockSize * this._outputChannels);
        }

        if (!indata && !outdata) break;

        const now = this._ctx!.currentTime;
        const streamTime: StreamTime = {
          inputBufferAdcTime: now,
          currentTime: now,
          outputBufferDacTime: now + this._blockSize / this._sampleRate,
        };

        this._callback(indata, outdata, this._blockSize, streamTime, 0 as CallbackFlag);

        if (isOut && outdata && this._outputRb) {
          this._outputRb.produce(outdata, this._blockSize);
        }
        count++;
        if (isIn && this._inputRb && !this._inputRb.hasNewData()) break;
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
      this._polling = false;
      throw err;
    }

    if (this._polling) {
      setTimeout(() => this._pollLoop(), 4);
    }
  }

  stop(): void {
    this._polling = false;
    this._started = false;
    this._cleanupNodes();
  }

  abort(): void {
    this._polling = false;
    this._started = false;
    this._cleanupNodes();
    this._ctx?.close();
    this._ctx = null;
  }

  close(): void {
    this._polling = false;
    this._started = false;
    this._cleanupNodes();
    this._mediaStream?.getTracks().forEach(t => t.stop());
    this._mediaStream = null;
    this._ctx?.close();
    this._ctx = null;
    this._closed = true;
  }

  private _cleanupNodes(): void {
    this._sourceNode?.disconnect();
    this._sourceNode = null;
    this._workletNode?.disconnect();
    this._workletNode = null;
  }

  get readAvailable(): number { return 0; }
  get writeAvailable(): number { return 0; }
  read(): Float32Array { throw new AudioError('Blocking read not supported in Web Audio backend. Use callback mode.'); }
  write(): void { throw new AudioError('Blocking write not supported in Web Audio backend. Use callback mode.'); }
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
  readonly devices: IDeviceManager & { refreshDevices(): Promise<DeviceInfo[]> };

  constructor() {
    this._deviceMgr = new WebDeviceManager();
    this.devices = Object.assign(this._deviceMgr, {
      refreshDevices: () => this._deviceMgr.refreshDevices(),
    });
  }

  getVersion(): string { return ''; }
  getVersionText(): string { return 'Web Audio API'; }
  async sleep(msec: number): Promise<void> { return new Promise(r => setTimeout(r, msec)); }

  openStream(
    kind: StreamKind,
    options: StreamOptions | DuplexStreamOptions,
    callback?: StreamCallback | null,
    finishedCallback?: StreamFinishedCallback | null,
  ): IAudioStream {
    if (!callback) {
      throw new AudioError('Web Audio backend requires a callback. Blocking mode is not supported in browsers.');
    }
    return new WebAudioStream(kind, options, callback, finishedCallback ?? null);
  }
}
