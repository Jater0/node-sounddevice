/// Error mapping helpers for PortAudio errors.

use std::ffi::CStr;
use crate::ffi;

/// Check a PortAudio error code and convert to Result.
/// Returns Ok(code) for non-negative codes, Err(String) for errors.
pub fn check(err: ffi::PaError, context: &str) -> Result<ffi::PaError, String> {
    if err >= 0 {
        return Ok(err);
    }

    let err_text = unsafe {
        let ptr = ffi::Pa_GetErrorText(err);
        if ptr.is_null() {
            "Unknown error".to_string()
        } else {
            CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    };

    let msg = if context.is_empty() {
        err_text
    } else {
        format!("{}: {}", context, err_text)
    };

    Err(msg)
}

/// Get the host API name for a given host API type ID.
pub unsafe fn host_api_type_name(typ: ffi::PaHostApiTypeId) -> &'static str {
    match typ {
        ffi::paInDevelopment => "In Development",
        ffi::paDirectSound => "DirectSound",
        ffi::paMME => "MME",
        ffi::paASIO => "ASIO",
        ffi::paSoundManager => "Sound Manager",
        ffi::paCoreAudio => "Core Audio",
        ffi::paOSS => "OSS",
        ffi::paALSA => "ALSA",
        ffi::paAL => "AL",
        ffi::paBeOS => "BeOS",
        ffi::paWDMKS => "WDMKS",
        ffi::paJACK => "JACK",
        ffi::paWASAPI => "WASAPI",
        ffi::paAudioScienceHPI => "AudioScience HPI",
        _ => "Unknown",
    }
}
