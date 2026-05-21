/// Device enumeration — N-API functions for querying PortAudio devices.
/// Exposed to JavaScript as methods on the native addon.

use napi::{Error, Result, Status};
use napi_derive::napi;
use std::ffi::CStr;

use crate::ffi;

/// Output type for a single device's information.
#[napi(object)]
pub struct JsDeviceInfo {
    pub id: u32,
    pub name: String,
    #[napi(js_name = "hostAPI")]
    pub host_api: u32,
    #[napi(js_name = "maxInputChannels")]
    pub max_input_channels: u32,
    #[napi(js_name = "maxOutputChannels")]
    pub max_output_channels: u32,
    #[napi(js_name = "defaultLowInputLatency")]
    pub default_low_input_latency: f64,
    #[napi(js_name = "defaultLowOutputLatency")]
    pub default_low_output_latency: f64,
    #[napi(js_name = "defaultHighInputLatency")]
    pub default_high_input_latency: f64,
    #[napi(js_name = "defaultHighOutputLatency")]
    pub default_high_output_latency: f64,
    #[napi(js_name = "defaultSampleRate")]
    pub default_sample_rate: f64,
}

/// Output type for a single host API's information.
#[napi(object)]
pub struct JsHostApiInfo {
    pub id: u32,
    pub name: String,
    #[napi(js_name = "deviceCount")]
    pub device_count: u32,
    #[napi(js_name = "defaultInputDevice")]
    pub default_input_device: i32,
    #[napi(js_name = "defaultOutputDevice")]
    pub default_output_device: i32,
}

/// Get the number of available audio devices.
#[napi]
pub fn get_device_count() -> Result<u32> {
    let count = unsafe { ffi::Pa_GetDeviceCount() };
    if count < 0 {
        return Err(Error::new(
            Status::GenericFailure,
            format!("Pa_GetDeviceCount failed: {}", count),
        ));
    }
    Ok(count as u32)
}

/// Get information about a specific device by index.
#[napi]
pub fn get_device_info(device_index: u32) -> Result<JsDeviceInfo> {
    let info = unsafe { ffi::Pa_GetDeviceInfo(device_index as i32) };
    if info.is_null() {
        return Err(Error::new(
            Status::GenericFailure,
            format!("Device {} not found", device_index),
        ));
    }

    let info = unsafe { &*info };
    let name = unsafe {
        CStr::from_ptr(info.name)
            .to_string_lossy()
            .into_owned()
    };

    Ok(JsDeviceInfo {
        id: device_index,
        name,
        host_api: info.hostApi as u32,
        max_input_channels: info.maxInputChannels as u32,
        max_output_channels: info.maxOutputChannels as u32,
        default_low_input_latency: info.defaultLowInputLatency,
        default_low_output_latency: info.defaultLowOutputLatency,
        default_high_input_latency: info.defaultHighInputLatency,
        default_high_output_latency: info.defaultHighOutputLatency,
        default_sample_rate: info.defaultSampleRate,
    })
}

/// Get the default input device index.
#[napi]
pub fn get_default_input_device() -> i32 {
    unsafe { ffi::Pa_GetDefaultInputDevice() }
}

/// Get the default output device index.
#[napi]
pub fn get_default_output_device() -> i32 {
    unsafe { ffi::Pa_GetDefaultOutputDevice() }
}

/// Get the number of host APIs.
#[napi]
pub fn get_host_api_count() -> Result<u32> {
    let count = unsafe { ffi::Pa_GetHostApiCount() };
    if count < 0 {
        return Err(Error::new(
            Status::GenericFailure,
            format!("Pa_GetHostApiCount failed: {}", count),
        ));
    }
    Ok(count as u32)
}

/// Get information about a specific host API by index.
#[napi]
pub fn get_host_api_info(host_api_index: u32) -> Result<JsHostApiInfo> {
    let info = unsafe { ffi::Pa_GetHostApiInfo(host_api_index as i32) };
    if info.is_null() {
        return Err(Error::new(
            Status::GenericFailure,
            format!("Host API {} not found", host_api_index),
        ));
    }

    let info = unsafe { &*info };
    let name = unsafe {
        CStr::from_ptr(info.name)
            .to_string_lossy()
            .into_owned()
    };

    Ok(JsHostApiInfo {
        id: host_api_index,
        name,
        device_count: info.deviceCount as u32,
        default_input_device: info.defaultInputDevice,
        default_output_device: info.defaultOutputDevice,
    })
}

/// Get the default host API index.
#[napi]
pub fn get_default_host_api() -> i32 {
    unsafe { ffi::Pa_GetDefaultHostApi() }
}

/// Get sample size in bytes for a given sample format.
#[napi]
pub fn get_sample_size(sample_format: u32) -> i32 {
    let err = unsafe { ffi::Pa_GetSampleSize(sample_format as u64) };
    if err < 0 { -1 } else { err }
}

/// Check if a given input configuration is supported.
#[napi]
pub fn check_input_settings(
    device: i32,
    channels: i32,
    sample_rate: f64,
    sample_format: u32,
    latency: f64,
) -> bool {
    let params = ffi::PaStreamParameters {
        device,
        channelCount: channels,
        sampleFormat: sample_format as u64,
        suggestedLatency: latency,
        hostApiSpecificStreamInfo: std::ptr::null_mut(),
    };

    let err = unsafe {
        ffi::Pa_IsFormatSupported(&params, std::ptr::null(), sample_rate)
    };
    err == ffi::paFormatIsSupported
}

/// Check if a given output configuration is supported.
#[napi]
pub fn check_output_settings(
    device: i32,
    channels: i32,
    sample_rate: f64,
    sample_format: u32,
    latency: f64,
) -> bool {
    let params = ffi::PaStreamParameters {
        device,
        channelCount: channels,
        sampleFormat: sample_format as u64,
        suggestedLatency: latency,
        hostApiSpecificStreamInfo: std::ptr::null_mut(),
    };

    let err = unsafe {
        ffi::Pa_IsFormatSupported(std::ptr::null(), &params, sample_rate)
    };
    err == ffi::paFormatIsSupported
}

/// Get PortAudio version number.
#[napi]
pub fn get_version() -> i32 {
    unsafe { ffi::Pa_GetVersion() }
}

/// Get PortAudio version text.
#[napi]
pub fn get_version_text() -> String {
    unsafe {
        let ptr = ffi::Pa_GetVersionText();
        if ptr.is_null() {
            String::new()
        } else {
            CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }
}
