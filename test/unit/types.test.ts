/**
 * 单元测试 — 类型定义验证
 */

import { describe, it, expect } from 'vitest';
import type {
  DeviceInfo,
  HostAPIInfo,
  StreamOptions,
  StreamKind,
  SampleFormat,
  BackendCapabilities,
} from '../../src/types';

describe('type compatibility', () => {
  it('DeviceInfo should have required fields', () => {
    const dev: DeviceInfo = {
      id: 0,
      name: 'Test Device',
      hostAPI: 0,
      maxInputChannels: 2,
      maxOutputChannels: 2,
      defaultLowInputLatency: 0.01,
      defaultLowOutputLatency: 0.01,
      defaultHighInputLatency: 0.05,
      defaultHighOutputLatency: 0.05,
      defaultSampleRate: 48000,
    };
    expect(dev.id).toBe(0);
    expect(dev.maxInputChannels).toBe(2);
  });

  it('StreamKind should accept valid values', () => {
    const kinds: StreamKind[] = ['input', 'output', 'duplex'];
    expect(kinds).toHaveLength(3);
  });

  it('SampleFormat should accept valid values', () => {
    const formats: SampleFormat[] = [
      'float32', 'int32', 'int16', 'int8', 'uint8', 'int24',
    ];
    expect(formats).toHaveLength(6);
  });

  it('BackendCapabilities should match PortAudio', () => {
    const cap: BackendCapabilities = {
      name: 'PortAudio',
      supportsInt24: true,
      supportsPlatformSettings: true,
      supportsCpuLoad: true,
      supportsHostAPIs: true,
      isRealtime: true,
    };
    expect(cap.name).toBe('PortAudio');
    expect(cap.supportsInt24).toBe(true);
  });

  it('BackendCapabilities should match Web Audio', () => {
    const cap: BackendCapabilities = {
      name: 'Web Audio',
      supportsInt24: false,
      supportsPlatformSettings: false,
      supportsCpuLoad: false,
      supportsHostAPIs: false,
      isRealtime: false,
    };
    expect(cap.supportsInt24).toBe(false);
    expect(cap.isRealtime).toBe(false);
  });
});
