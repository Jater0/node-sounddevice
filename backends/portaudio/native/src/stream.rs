/// Stream lifecycle — N-API functions for PortAudio stream management.
///
/// Architecture:
/// - Each open stream gets a unique u32 handle ID, stored in a global registry.
/// - The PortAudio callback runs in a real-time OS thread.
/// - For callback mode: a Rust callback bridges to JS via ThreadsafeFunction (Phase 2c).
/// - For blocking mode: Pa_ReadStream / Pa_WriteStream are called from the JS thread.

use napi::{Error, Result, Status};
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::Mutex;
use once_cell::sync::Lazy;

use crate::ffi;
use crate::error;

// ─── Global Stream Registry ────────────────────────

static STREAM_REGISTRY: Lazy<Mutex<HashMap<u32, StreamHandle>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static NEXT_STREAM_ID: Lazy<Mutex<u32>> = Lazy::new(|| Mutex::new(1));

fn register_stream(handle: StreamHandle) -> u32 {
    let mut registry = STREAM_REGISTRY.lock().unwrap();
    let mut id_counter = NEXT_STREAM_ID.lock().unwrap();
    let id = *id_counter;
    *id_counter += 1;
    registry.insert(id, handle);
    id
}

fn with_stream<T>(id: u32, f: impl FnOnce(&StreamHandle) -> Result<T>) -> Result<T> {
    let registry = STREAM_REGISTRY.lock().unwrap();
    let handle = registry
        .get(&id)
        .ok_or_else(|| Error::new(Status::GenericFailure, format!("Stream {} not found", id)))?;
    f(handle)
}

fn with_stream_mut<T>(id: u32, f: impl FnOnce(&mut StreamHandle) -> Result<T>) -> Result<T> {
    let mut registry = STREAM_REGISTRY.lock().unwrap();
    let handle = registry
        .get_mut(&id)
        .ok_or_else(|| Error::new(Status::GenericFailure, format!("Stream {} not found", id)))?;
    f(handle)
}

fn remove_stream(id: u32) -> Option<StreamHandle> {
    let mut registry = STREAM_REGISTRY.lock().unwrap();
    registry.remove(&id)
}

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

// ─── StreamHandle ──────────────────────────────────

struct StreamHandle {
    ptr: *mut ffi::PaStream,
    input_channels: u32,
    output_channels: u32,
    sample_size: u32,
    sample_format: ffi::PaSampleFormat,
}

unsafe impl Send for StreamHandle {}
unsafe impl Sync for StreamHandle {}

impl StreamHandle {
    fn new(
        ptr: *mut ffi::PaStream,
        input_channels: u32,
        output_channels: u32,
        sample_size: u32,
        sample_format: ffi::PaSampleFormat,
    ) -> Self {
        Self { ptr, input_channels, output_channels, sample_size, sample_format }
    }
}

impl Drop for StreamHandle {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            unsafe {
                // Ensure stream is stopped before closing
                ffi::Pa_StopStream(self.ptr);
                ffi::Pa_CloseStream(self.ptr);
            }
        }
    }
}

// ─── PortAudio Callback (Rust side) ────────────────

/// Rust-side PortAudio callback.
/// For blocking streams (no JS callback), this is never called.
/// For callback streams, this runs in the PortAudio real-time thread.
unsafe extern "C" fn pa_callback(
    input: *const c_void,
    output: *mut c_void,
    frame_count: u64,
    _time_info: *const ffi::PaStreamCallbackTimeInfo,
    _status_flags: ffi::PaStreamCallbackFlags,
    user_data: *mut c_void,
) -> i32 {
    if user_data.is_null() {
        return ffi::paAbort;
    }

    let handle: &StreamHandle = &*(user_data as *const StreamHandle);

    let in_ch = handle.input_channels as usize;
    let out_ch = handle.output_channels as usize;
    let fc = frame_count as usize;
    let sample_size = handle.sample_size as usize;

    // For output: fill with silence (zero)
    if !output.is_null() && out_ch > 0 {
        let buf = std::slice::from_raw_parts_mut(output as *mut u8, fc * out_ch * sample_size);
        buf.fill(0);
    }

    // For input: data is available in `input` buffer but we ignore it in blocking mode.
    // In callback mode (Phase 2c), we'd forward it via ThreadsafeFunction.
    let _ = input;
    let _ = in_ch;

    ffi::paContinue
}

// ─── open_stream ──────────────────────────────────

/// Open a PortAudio stream.
///
/// Returns a stream handle ID (u32) for subsequent operations.
/// - If a callback is needed, pass `has_callback = true` (Phase 2c).
/// - For blocking mode, pass `has_callback = false`.
#[napi]
pub fn open_stream(
    device: i32,
    channels: u32,
    sample_format: u32,
    sample_rate: f64,
    latency: f64,
    block_size: u32,
    flags: u32,
    is_input: bool,
    is_output: bool,
    has_callback: bool,
) -> Result<u32> {
    // Determine input/output parameters
    let (inp_ptr, outp_ptr, in_ch, out_ch) = if is_input && is_output {
        let inp = ffi::PaStreamParameters {
            device,
            channelCount: channels as i32,
            sampleFormat: sample_format as u64,
            suggestedLatency: latency,
            hostApiSpecificStreamInfo: std::ptr::null_mut(),
        };
        let outp = ffi::PaStreamParameters {
            device,
            channelCount: channels as i32,
            sampleFormat: sample_format as u64,
            suggestedLatency: latency,
            hostApiSpecificStreamInfo: std::ptr::null_mut(),
        };
        (&inp as *const _, &outp as *const _, channels, channels)
    } else if is_input {
        let inp = ffi::PaStreamParameters {
            device,
            channelCount: channels as i32,
            sampleFormat: sample_format as u64,
            suggestedLatency: latency,
            hostApiSpecificStreamInfo: std::ptr::null_mut(),
        };
        (&inp as *const _, std::ptr::null(), channels, 0)
    } else {
        let outp = ffi::PaStreamParameters {
            device,
            channelCount: channels as i32,
            sampleFormat: sample_format as u64,
            suggestedLatency: latency,
            hostApiSpecificStreamInfo: std::ptr::null_mut(),
        };
        (std::ptr::null(), &outp as *const _, 0, channels)
    };

    // Get sample size
    let sample_size = unsafe { ffi::Pa_GetSampleSize(sample_format as u64) };
    if sample_size < 0 {
        return Err(Error::new(
            Status::GenericFailure,
            format!("Invalid sample format: {}", sample_format),
        ));
    }
    let sample_size = sample_size as u32;

    // Allocate the stream handle BEFORE opening the stream.
    let stream_handle = Box::new(StreamHandle::new(
        std::ptr::null_mut(),
        in_ch,
        out_ch,
        sample_size,
        sample_format as u64,
    ));

    let callback: ffi::PaStreamCallback = if has_callback {
        Some(pa_callback)
    } else {
        None
    };

    let user_data = &*stream_handle as *const StreamHandle as *mut c_void;

    let mut stream: *mut ffi::PaStream = std::ptr::null_mut();

    let err = unsafe {
        ffi::Pa_OpenStream(
            &mut stream,
            inp_ptr,
            outp_ptr,
            sample_rate,
            block_size as u64,
            flags as u64,
            callback,
            user_data,
        )
    };

    if err != ffi::paNoError {
        let msg = error::check(err, "Error opening stream").unwrap_err();
        return Err(Error::new(Status::GenericFailure, msg));
    }

    if stream.is_null() {
        return Err(Error::new(Status::GenericFailure, "Stream is null after open"));
    }

    let mut handle = stream_handle;
    handle.ptr = stream;

    let id = register_stream(*handle);
    Ok(id)
}

// ─── Stream Control ───────────────────────────────

#[napi]
pub fn start_stream(id: u32) -> Result<()> {
    with_stream(id, |handle| {
        if handle.ptr.is_null() {
            return Err(Error::new(Status::GenericFailure, "Stream pointer is null"));
        }
        let err = unsafe { ffi::Pa_StartStream(handle.ptr) };
        if err != ffi::paNoError && err != ffi::paStreamIsNotStopped {
            let msg = error::check(err, "Error starting stream").unwrap_err();
            return Err(Error::new(Status::GenericFailure, msg));
        }
        Ok(())
    })
}

/// Set a finished callback on the stream.
/// The finished_callback is called when the stream finishes playing (paComplete).
#[napi]
pub fn set_stream_finished_callback(id: u32) -> Result<()> {
    // Phase 2c: register a ThreadsafeFunction for finished callback
    // For now, this is a no-op — the callback won't fire.
    let _ = id;
    Ok(())
}

#[napi]
pub fn stop_stream(id: u32) -> Result<()> {
    with_stream(id, |handle| {
        if handle.ptr.is_null() {
            return Ok(());
        }
        let err = unsafe { ffi::Pa_StopStream(handle.ptr) };
        if err != ffi::paNoError {
            let msg = error::check(err, "Error stopping stream").unwrap_err();
            return Err(Error::new(Status::GenericFailure, msg));
        }
        Ok(())
    })
}

#[napi]
pub fn abort_stream(id: u32) -> Result<()> {
    with_stream(id, |handle| {
        if handle.ptr.is_null() {
            return Ok(());
        }
        let err = unsafe { ffi::Pa_AbortStream(handle.ptr) };
        if err != ffi::paNoError {
            let msg = error::check(err, "Error aborting stream").unwrap_err();
            return Err(Error::new(Status::GenericFailure, msg));
        }
        Ok(())
    })
}

#[napi]
pub fn close_stream(id: u32) -> Result<()> {
    let handle = remove_stream(id);
    if handle.is_none() {
        return Err(Error::new(Status::GenericFailure, format!("Stream {} not found", id)));
    }
    // handle.drop() will call Pa_CloseStream
    Ok(())
}

#[napi]
pub fn is_stream_active(id: u32) -> Result<bool> {
    with_stream(id, |handle| {
        if handle.ptr.is_null() {
            return Ok(false);
        }
        let err = unsafe { ffi::Pa_IsStreamActive(handle.ptr) };
        Ok(err == 1)
    })
}

#[napi]
pub fn is_stream_stopped(id: u32) -> Result<bool> {
    with_stream(id, |handle| {
        if handle.ptr.is_null() {
            return Ok(true);
        }
        let err = unsafe { ffi::Pa_IsStreamStopped(handle.ptr) };
        Ok(err == 1)
    })
}

// ─── Stream Info ──────────────────────────────────

#[napi(object)]
pub struct JsStreamInfo {
    pub input_latency: f64,
    pub output_latency: f64,
    pub sample_rate: f64,
}

#[napi]
pub fn get_stream_info(id: u32) -> Result<JsStreamInfo> {
    with_stream(id, |handle| {
        if handle.ptr.is_null() {
            return Err(Error::new(Status::GenericFailure, "Stream is closed"));
        }
        let info = unsafe { ffi::Pa_GetStreamInfo(handle.ptr) };
        if info.is_null() {
            return Err(Error::new(Status::GenericFailure, "Could not obtain stream info"));
        }
        let info = unsafe { &*info };
        Ok(JsStreamInfo {
            input_latency: info.inputLatency,
            output_latency: info.outputLatency,
            sample_rate: info.sampleRate,
        })
    })
}

#[napi]
pub fn get_stream_time(id: u32) -> Result<f64> {
    with_stream(id, |handle| {
        if handle.ptr.is_null() {
            return Err(Error::new(Status::GenericFailure, "Stream is closed"));
        }
        let time = unsafe { ffi::Pa_GetStreamTime(handle.ptr) };
        Ok(time)
    })
}

#[napi]
pub fn get_stream_cpu_load(id: u32) -> Result<f64> {
    with_stream(id, |handle| {
        if handle.ptr.is_null() {
            return Err(Error::new(Status::GenericFailure, "Stream is closed"));
        }
        let load = unsafe { ffi::Pa_GetStreamCpuLoad(handle.ptr) };
        Ok(load)
    })
}

// ─── Blocking Read / Write ────────────────────────

#[napi]
pub fn read_stream(id: u32, frames: u32) -> Result<Buffer> {
    with_stream(id, |handle| {
        if handle.ptr.is_null() {
            return Err(Error::new(Status::GenericFailure, "Stream is closed"));
        }
        if handle.input_channels == 0 {
            return Err(Error::new(Status::GenericFailure, "Not an input stream"));
        }

        let sample_count = frames as usize * handle.input_channels as usize;
        let byte_count = sample_count * handle.sample_size as usize;
        let mut buf: Vec<u8> = vec![0u8; byte_count];

        let err = unsafe {
            ffi::Pa_ReadStream(
                handle.ptr,
                buf.as_mut_ptr() as *mut c_void,
                frames as u64,
            )
        };

        error::check(err, "Error reading from stream")
            .map_err(|e| Error::new(Status::GenericFailure, e))?;

        Ok(buf.into())
    })
}

#[napi]
pub fn write_stream(id: u32, data: Buffer) -> Result<()> {
    with_stream(id, |handle| {
        if handle.ptr.is_null() {
            return Err(Error::new(Status::GenericFailure, "Stream is closed"));
        }
        if handle.output_channels == 0 {
            return Err(Error::new(Status::GenericFailure, "Not an output stream"));
        }

        let err = unsafe {
            ffi::Pa_WriteStream(
                handle.ptr,
                data.as_ptr() as *const c_void,
                (data.len() / (handle.output_channels as usize * handle.sample_size as usize)) as u64,
            )
        };

        error::check(err, "Error writing to stream")
            .map_err(|e| Error::new(Status::GenericFailure, e))?;

        Ok(())
    })
}

#[napi]
pub fn get_read_available(id: u32) -> Result<i64> {
    with_stream(id, |handle| {
        if handle.ptr.is_null() {
            return Err(Error::new(Status::GenericFailure, "Stream is closed"));
        }
        let available = unsafe { ffi::Pa_GetStreamReadAvailable(handle.ptr) };
        Ok(available)
    })
}

#[napi]
pub fn get_write_available(id: u32) -> Result<i64> {
    with_stream(id, |handle| {
        if handle.ptr.is_null() {
            return Err(Error::new(Status::GenericFailure, "Stream is closed"));
        }
        let available = unsafe { ffi::Pa_GetStreamWriteAvailable(handle.ptr) };
        Ok(available)
    })
}
