/**
 * Web 后端集成测试
 *
 * 测试 WebBackend 的实例化和基础功能。
 * 注意：jsdom 不完全支持 Web Audio API，因此仅测试非 AudioContext 路径。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { WebBackend } from '../../backends/web/index.js';
import type { IBackend } from '../../src/interfaces.js';

describe('WebBackend', () => {
  let backend: IBackend;

  beforeAll(() => {
    backend = new WebBackend();
  });

  it('should report Web Audio capabilities', () => {
    expect(backend.capabilities.name).toBe('Web Audio');
    expect(backend.capabilities.supportsInt24).toBe(false);
    expect(backend.capabilities.supportsPlatformSettings).toBe(false);
    expect(backend.capabilities.supportsCpuLoad).toBe(false);
    expect(backend.capabilities.isRealtime).toBe(false);
  });

  it('should return empty version for web', () => {
    expect(backend.getVersion()).toBe('');
  });

  it('should return "Web Audio API" version text', () => {
    expect(backend.getVersionText()).toBe('Web Audio API');
  });

  it('should sleep via setTimeout', async () => {
    const start = Date.now();
    await backend.sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('should return empty devices before enumeration', () => {
    expect(backend.devices.getDevices()).toEqual([]);
  });

  it('should return single pseudo host API', () => {
    const apis = backend.devices.getHostAPIs();
    expect(apis).toHaveLength(1);
    expect(apis[0]!.name).toBe('Web Audio');
  });

  it('should throw when opening stream without callback', () => {
    expect(() => {
      backend.openStream('output', { sampleRate: 48000, channels: 1 }, null);
    }).toThrow('Web Audio backend requires a callback');
  });

  it('should throw when using blocking read', () => {
    const stream = backend.openStream(
      'output',
      { sampleRate: 48000, channels: 1 },
      () => {},
    );
    expect(() => stream.read(100)).toThrow('Blocking read not supported');
    expect(() => stream.write(new Float32Array(100))).toThrow('Blocking write not supported');
  });
});
