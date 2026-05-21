/// Stream lifecycle — N-API functions for PortAudio stream management.
///
/// Architecture:
/// - The PortAudio callback runs in a real-time OS thread.
/// - We use `napi::threadsafe_function` to forward audio data to JavaScript.
/// - Stream state is managed by a Rust struct that owns the PaStream pointer.

use napi::{Error, Result, Status};
use napi_derive::napi;
use std::ffi::c_void;
use std::sync::Mutex;

use crate::ffi;
use crate::error;

// ─── Stream Parameters (input from JS) ────────────

#[napi(object)]
pub struct JsStreamParams {
    pub device: i32,
    pub channels: u32,
    pub sample_format: u32,
    pub sample_rate: f64,
    pub latency: f64,
    pub block_size: u32,
    pub flags: u32,
    pub is_input: bool,
    pub is_output: bool,
}

/// Initialized stream handle.
/// Wraps a PaStream pointer. ReferenceCounted to allow sharing with callback.
pub struct StreamHandle {
    ptr: *mut ffi::PaStream,
    input_channels: u32,
    output_channels: u32,
    sample_size: u32,
}

unsafe impl Send for StreamHandle {}
unsafe impl Sync for StreamHandle {}

impl StreamHandle {
    pub fn new(
        ptr: *mut ffi::PaStream,
        input_channels: u32,
        output_channels: u32,
        sample_size: u32,
    ) -> Self {
        Self { ptr, input_channels, output_channels, sample_size }
    }

    pub fn is_null(&self) -> bool {
        self.ptr.is_null()
    }
}

impl Drop for StreamHandle {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            unsafe {
                ffi::Pa_CloseStream(self.ptr);
            }
        }
    }
}

// ─── Open Stream ──────────────────────────────────

/// Internal: open a PortAudio stream and return its raw pointer.
/// This is called from the main JS thread via the napi-rs generated binding.
///
/// Returns a JSON-like string describing the stream handle (for now).
/// Phase 2b: return a proper external reference.
#[napi]
pub fn open_stream(params: &JsStreamParams) -> Result<()> {
    // Determine input/output parameters
    let (input_params, output_params) = if params.is_input && params.is_output {
        let inp = ffi::PaStreamParameters {
            device: params.device,
            channelCount: params.channels as i32,
            sampleFormat: params.sample_format as u64,
            suggestedLatency: params.latency,
            hostApiSpecificStreamInfo: std::ptr::null_mut(),
        };
        let outp = ffi::PaStreamParameters {
            device: params.device,
            channelCount: params.channels as i32,
            sampleFormat: params.sample_format as u64,
            suggestedLatency: params.latency,
            hostApiSpecificStreamInfo: std::ptr::null_mut(),
        };
        (Some(inp), Some(outp))
    } else if params.is_input {
        let inp = ffi::PaStreamParameters {
            device: params.device,
            channelCount: params.channels as i32,
            sampleFormat: params.sample_format as u64,
            suggestedLatency: params.latency,
            hostApiSpecificStreamInfo: std::ptr::null_mut(),
        };
        (Some(inp), None)
    } else {
        let outp = ffi::PaStreamParameters {
            device: params.device,
            channelCount: params.channels as i32,
            sampleFormat: params.sample_format as u64,
            suggestedLatency: params.latency,
            hostApiSpecificStreamInfo: std::ptr::null_mut(),
        };
        (None, Some(outp))
    };

    let inp_ptr: *const ffi::PaStreamParameters = match &input_params {
        Some(p) => p as *const _,
        None => std::ptr::null(),
    };
    let outp_ptr: *const ffi::PaStreamParameters = match &output_params {
        Some(p) => p as *const _,
        None => std::ptr::null(),
    };

    let mut stream: *mut ffi::PaStream = std::ptr::null_mut();

    let err = unsafe {
        ffi::Pa_OpenStream(
            &mut stream,
            inp_ptr,
            outp_ptr,
            params.sample_rate,
            params.block_size as u64,
            params.flags as u64,
            None, // no callback = blocking mode for now
            std::ptr::null_mut(),
        )
    };

    error::check(err, "Error opening stream")?;

    if stream.is_null() {
        return Err(Error::new(Status::GenericFailure, "Stream is null after open"));
    }

    // For now, just close it immediately — the stream handle management
    // will be implemented properly in Phase 2b with ThreadsafeFunction.
    unsafe {
        ffi::Pa_CloseStream(stream);
    }

    Ok(())
}

// ─── Stream Control ───────────────────────────────

/// Start a stream.
#[napi]
pub fn start_stream(_stream_ptr: u32) -> Result<()> {
    // Phase 2b: deref stream handle and call Pa_StartStream
    Err(Error::new(
        Status::GenericFailure,
        "start_stream: Phase 2b — stream handle management not yet implemented",
    ))
}

/// Stop a stream.
#[napi]
pub fn stop_stream(_stream_ptr: u32) -> Result<()> {
    // Phase 2b
    Err(Error::new(Status::GenericFailure, "stop_stream: not yet implemented"))
}

/// Abort a stream.
#[napi]
pub fn abort_stream(_stream_ptr: u32) -> Result<()> {
    // Phase 2b
    Err(Error::new(Status::GenericFailure, "abort_stream: not yet implemented"))
}

/// Close a stream.
#[napi]
pub fn close_stream(_stream_ptr: u32) -> Result<()> {
    // Phase 2b
    Err(Error::new(Status::GenericFailure, "close_stream: not yet implemented"))
}

/// Check if a stream is active.
#[napi]
pub fn is_stream_active(_stream_ptr: u32) -> Result<bool> {
    // Phase 2b
    Ok(false)
}

/// Get stream info (latency, sample rate).
#[napi(object)]
pub struct JsStreamInfo {
    pub input_latency: f64,
    pub output_latency: f64,
    pub sample_rate: f64,
}

#[napi]
pub fn get_stream_info(_stream_ptr: u32) -> Result<JsStreamInfo> {
    Err(Error::new(Status::GenericFailure, "get_stream_info: not yet implemented"))
}

/// Get stream time.
#[napi]
pub fn get_stream_time(_stream_ptr: u32) -> Result<f64> {
    Err(Error::new(Status::GenericFailure, "get_stream_time: not yet implemented"))
}

/// Get stream CPU load.
#[napi]
pub fn get_stream_cpu_load(_stream_ptr: u32) -> Result<f64> {
    Err(Error::new(Status::GenericFailure, "get_stream_cpu_load: not yet implemented"))
}

// ─── Blocking Read/Write ──────────────────────────

#[napi]
pub fn read_stream(_stream_ptr: u32, _frames: u32) -> Result<Vec<u8>> {
    Err(Error::new(Status::GenericFailure, "read_stream: not yet implemented"))
}

#[napi]
pub fn write_stream(_stream_ptr: u32, _data: Vec<u8>) -> Result<()> {
    Err(Error::new(Status::GenericFailure, "write_stream: not yet implemented"))
}

#[napi]
pub fn get_read_available(_stream_ptr: u32) -> Result<i64> {
    Err(Error::new(Status::GenericFailure, "get_read_available: not yet implemented"))
}

#[napi]
pub fn get_write_available(_stream_ptr: u32) -> Result<i64> {
    Err(Error::new(Status::GenericFailure, "get_write_available: not yet implemented"))
}
