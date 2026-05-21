/**
 * 单元测试 — 类型、错误、默认值
 */

import { describe, it, expect } from 'vitest';
import { AudioError, CallbackStop, CallbackAbort, isCallbackControl } from '../../src/errors.js';
import { defaults, splitPair, selectFromPair } from '../../src/defaults.js';

describe('AudioError', () => {
  it('should create with message', () => {
    const err = new AudioError('test error');
    expect(err.message).toBe('test error');
    expect(err.name).toBe('AudioError');
    expect(err.paErrorCode).toBe(-1);
    expect(err.hostErrorInfo).toBeNull();
  });

  it('should store error code', () => {
    const err = new AudioError('test', -9985);
    expect(err.paErrorCode).toBe(-9985);
  });

  it('should store host error info', () => {
    const hostInfo = { hostApi: 1, errorCode: 42, errorText: 'host error' };
    const err = new AudioError('test', -9999, hostInfo);
    expect(err.hostErrorInfo).toEqual(hostInfo);
  });
});

describe('CallbackStop / CallbackAbort', () => {
  it('should be instances of Error', () => {
    expect(new CallbackStop()).toBeInstanceOf(Error);
    expect(new CallbackAbort()).toBeInstanceOf(Error);
  });

  it('should have correct names', () => {
    expect(new CallbackStop().name).toBe('CallbackStop');
    expect(new CallbackAbort().name).toBe('CallbackAbort');
  });
});

describe('isCallbackControl', () => {
  it('should detect CallbackStop', () => {
    expect(isCallbackControl(new CallbackStop())).toBe(true);
  });

  it('should detect CallbackAbort', () => {
    expect(isCallbackControl(new CallbackAbort())).toBe(true);
  });

  it('should reject regular errors', () => {
    expect(isCallbackControl(new Error('nope'))).toBe(false);
    expect(isCallbackControl(new AudioError('nope'))).toBe(false);
    expect(isCallbackControl('string')).toBe(false);
    expect(isCallbackControl(null)).toBe(false);
  });
});

describe('defaults', () => {
  it('should have sensible initial values', () => {
    expect(defaults.sampleRate).toBeNull();
    expect(defaults.blockSize).toBe(0);
    expect(defaults.dtype).toEqual(['float32', 'float32']);
    expect(defaults.latency).toEqual(['high', 'high']);
    expect(defaults.clipOff).toBe(false);
  });

  it('should support setting values', () => {
    defaults.sampleRate = 48000;
    expect(defaults.sampleRate).toBe(48000);
    defaults.sampleRate = null; // reset
  });

  it('should reset to factory defaults', () => {
    defaults.sampleRate = 96000;
    defaults.clipOff = true;
    defaults.reset();
    expect(defaults.sampleRate).toBeNull();
    expect(defaults.clipOff).toBe(false);
  });
});

describe('splitPair', () => {
  it('should split tuple pair', () => {
    expect(splitPair([1, 2])).toEqual([1, 2]);
  });

  it('should duplicate single value', () => {
    expect(splitPair(42)).toEqual([42, 42]);
    expect(splitPair('float32')).toEqual(['float32', 'float32']);
  });
});

describe('selectFromPair', () => {
  it('should select input from pair', () => {
    expect(selectFromPair([1, 2], 'input')).toBe(1);
  });

  it('should select output from pair', () => {
    expect(selectFromPair([1, 2], 'output')).toBe(2);
  });

  it('should select from single value', () => {
    expect(selectFromPair(42, 'input')).toBe(42);
    expect(selectFromPair(42, 'output')).toBe(42);
  });
});
