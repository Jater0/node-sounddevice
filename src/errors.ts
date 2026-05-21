/**
 * 错误类型 — node-sounddevice
 *
 * 对应 python-sounddevice 中的 PortAudioError, CallbackStop, CallbackAbort
 */

/**
 * 音频错误基类。
 * 对应 Python 的 PortAudioError。
 */
export class AudioError extends Error {
  /** PortAudio 错误码（Web 后端为 -1） */
  readonly paErrorCode: number;
  /** 宿主 API 错误信息（如果有） */
  readonly hostErrorInfo: {
    hostApi: number;
    errorCode: number;
    errorText: string;
  } | null;

  constructor(
    message: string,
    paErrorCode: number = -1,
    hostErrorInfo?: { hostApi: number; errorCode: number; errorText: string } | null,
  ) {
    super(message);
    this.name = 'AudioError';
    this.paErrorCode = paErrorCode;
    this.hostErrorInfo = hostErrorInfo ?? null;
  }
}

/**
 * 在流回调中抛出此异常以正常停止回调处理。
 * 对应 Python 的 CallbackStop。
 *
 * 与 CallbackAbort 的区别：
 * - CallbackStop：等待所有待播缓冲区播放完毕后停止
 * - CallbackAbort：立即丢弃所有待播缓冲区
 */
export class CallbackStop extends Error {
  constructor(message: string = 'Callback stopped by user') {
    super(message);
    this.name = 'CallbackStop';
  }
}

/**
 * 在流回调中抛出此异常以立即中止回调处理。
 * 对应 Python 的 CallbackAbort。
 */
export class CallbackAbort extends Error {
  constructor(message: string = 'Callback aborted by user') {
    super(message);
    this.name = 'CallbackAbort';
  }
}

/** 检查一个值是否是 CallbackStop 或 CallbackAbort */
export function isCallbackControl(
  err: unknown,
): err is CallbackStop | CallbackAbort {
  return err instanceof CallbackStop || err instanceof CallbackAbort;
}
