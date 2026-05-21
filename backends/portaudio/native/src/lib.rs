#![deny(clippy::all)]
#![allow(dead_code)]

//! node-sounddevice-native
//! PortAudio native addon for Node.js via napi-rs.
//!
//! Provides:
//! - Device enumeration (get_device_count, get_device_info, ...)
//! - Host API enumeration (get_host_api_count, get_host_api_info, ...)
//! - Stream lifecycle (open_stream, start_stream, stop_stream, ...)
//! - Blocking read/write (read_stream, write_stream)
//! - PortAudio constants (sample formats, flags, error codes)

#[macro_use]
extern crate napi_derive;

mod ffi;
mod error;
mod device;
mod stream;

use napi::Result;
use once_cell::sync::OnceCell;

/// Global initialization state — PortAudio is initialized exactly once.
static INITIALIZED: OnceCell<bool> = OnceCell::new();

/// Initialize PortAudio. Safe to call multiple times — only initializes once.
fn ensure_initialized() -> Result<()> {
    INITIALIZED.get_or_try_init(|| {
        let err = unsafe { ffi::Pa_Initialize() };
        if err != ffi::paNoError {
            let msg = error::check(err, "Error initializing PortAudio")
                .unwrap_err();
            return Err(napi::Error::new(
                napi::Status::GenericFailure,
                msg,
            ));
        }
        Ok(true)
    })?;
    Ok(())
}

/// Terminate PortAudio. Called on process exit or explicitly.
#[napi]
pub fn terminate() -> Result<()> {
    // PortAudio allows Pa_Terminate to be called multiple times
    let err = unsafe { ffi::Pa_Terminate() };
    if err != ffi::paNoError && err != ffi::paNotInitialized {
        return Err(napi::Error::new(
            napi::Status::GenericFailure,
            format!("Error terminating PortAudio: {}", err),
        ));
    }
    Ok(())
}

/// Explicitly initialize PortAudio (normally auto-initializes on first use).
#[napi]
pub fn initialize() -> Result<()> {
    ensure_initialized()
}

/// Sleep for the given number of milliseconds.
/// Uses PortAudio's Pa_Sleep which is safe to call from any thread.
#[napi]
pub fn sleep(msec: u32) -> Result<()> {
    unsafe { ffi::Pa_Sleep(msec as i64) };
    Ok(())
}

// Re-export device functions
pub use device::{
    get_device_count,
    get_device_info,
    get_default_input_device,
    get_default_output_device,
    get_host_api_count,
    get_host_api_info,
    get_default_host_api,
    get_sample_size,
    check_input_settings,
    check_output_settings,
    get_version,
    get_version_text,
};

// Re-export stream functions
pub use stream::{
    open_stream,
    start_stream,
    stop_stream,
    abort_stream,
    close_stream,
    is_stream_active,
    get_stream_info,
    get_stream_time,
    get_stream_cpu_load,
    read_stream,
    write_stream,
    get_read_available,
    get_write_available,
};

// ─── Constants ────────────────────────────────────

/// paFloat32 constant
#[napi]
pub const PA_FLOAT32: u32 = ffi::paFloat32 as u32;

/// paInt32 constant
#[napi]
pub const PA_INT32: u32 = ffi::paInt32 as u32;

/// paInt24 constant
#[napi]
pub const PA_INT24: u32 = ffi::paInt24 as u32;

/// paInt16 constant
#[napi]
pub const PA_INT16: u32 = ffi::paInt16 as u32;

/// paInt8 constant
#[napi]
pub const PA_INT8: u32 = ffi::paInt8 as u32;

/// paUInt8 constant
#[napi]
pub const PA_UINT8: u32 = ffi::paUInt8 as u32;

/// paNoFlag constant
#[napi]
pub const PA_NO_FLAG: u32 = ffi::paNoFlag as u32;

/// paClipOff constant
#[napi]
pub const PA_CLIP_OFF: u32 = ffi::paClipOff as u32;

/// paDitherOff constant
#[napi]
pub const PA_DITHER_OFF: u32 = ffi::paDitherOff as u32;

/// paNeverDropInput constant
#[napi]
pub const PA_NEVER_DROP_INPUT: u32 = ffi::paNeverDropInput as u32;

/// paPrimeOutputBuffersUsingStreamCallback constant
#[napi]
pub const PA_PRIME_OUTPUT: u32 = ffi::paPrimeOutputBuffersUsingStreamCallback as u32;

// ─── Process Exit Handler ─────────────────────────

/// Register cleanup on process exit.
/// This is called from JavaScript: `process.on('exit', () => native.terminate())`
#[napi]
pub fn register_exit_handler() -> Result<()> {
    // The actual registration happens in JavaScript since Node.js
    // process.on('exit') is JS-land only.
    // We just provide the terminate function.
    Ok(())
}
