#![allow(
    non_camel_case_types,
    non_upper_case_globals,
    non_snake_case,
    dead_code
)]

//! Raw PortAudio C FFI bindings.
//! Mirrors the C declarations from python-sounddevice/sounddevice_build.py

use std::ffi::c_void;

// ─── Basic Types ──────────────────────────────────

pub type PaError = i32;
pub type PaDeviceIndex = i32;
pub type PaHostApiIndex = i32;
pub type PaTime = f64;
pub type PaSampleFormat = u64;
pub type PaStreamFlags = u64;
pub type PaStreamCallbackFlags = u64;

// ─── Special Constants ────────────────────────────

pub const paNoDevice: PaDeviceIndex = -1;
pub const paUseHostApiSpecificDeviceSpecification: PaDeviceIndex = -2;
pub const paFramesPerBufferUnspecified: u64 = 0;

// ─── Sample Formats ───────────────────────────────

pub const paFloat32: PaSampleFormat = 0x00000001;
pub const paInt32: PaSampleFormat   = 0x00000002;
pub const paInt24: PaSampleFormat   = 0x00000004;
pub const paInt16: PaSampleFormat   = 0x00000008;
pub const paInt8: PaSampleFormat    = 0x00000010;
pub const paUInt8: PaSampleFormat   = 0x00000020;
pub const paCustomFormat: PaSampleFormat = 0x00010000;
pub const paNonInterleaved: PaSampleFormat = 0x80000000;

// ─── Stream Flags ─────────────────────────────────

pub const paNoFlag: PaStreamFlags = 0;
pub const paClipOff: PaStreamFlags = 0x00000001;
pub const paDitherOff: PaStreamFlags = 0x00000002;
pub const paNeverDropInput: PaStreamFlags = 0x00000004;
pub const paPrimeOutputBuffersUsingStreamCallback: PaStreamFlags = 0x00000008;
pub const paPlatformSpecificFlags: PaStreamFlags = 0xFFFF0000;

// ─── Callback Flags ───────────────────────────────

pub const paInputUnderflow: PaStreamCallbackFlags = 0x00000001;
pub const paInputOverflow: PaStreamCallbackFlags = 0x00000002;
pub const paOutputUnderflow: PaStreamCallbackFlags = 0x00000004;
pub const paOutputOverflow: PaStreamCallbackFlags = 0x00000008;
pub const paPrimingOutput: PaStreamCallbackFlags = 0x00000010;

// ─── Callback Return Values ───────────────────────

pub const paContinue: i32 = 0;
pub const paComplete: i32 = 1;
pub const paAbort: i32 = 2;

// ─── Host API Type IDs ────────────────────────────

pub const paInDevelopment: i32 = 0;
pub const paDirectSound: i32 = 1;
pub const paMME: i32 = 2;
pub const paASIO: i32 = 3;
pub const paSoundManager: i32 = 4;
pub const paCoreAudio: i32 = 5;
pub const paOSS: i32 = 7;
pub const paALSA: i32 = 8;
pub const paAL: i32 = 9;
pub const paBeOS: i32 = 10;
pub const paWDMKS: i32 = 11;
pub const paJACK: i32 = 12;
pub const paWASAPI: i32 = 13;
pub const paAudioScienceHPI: i32 = 14;

// ─── Error Codes ──────────────────────────────────

pub const paNoError: PaError = 0;
pub const paNotInitialized: PaError = -10000;
pub const paUnanticipatedHostError: PaError = -9999;
pub const paInvalidChannelCount: PaError = -9998;
pub const paInvalidSampleRate: PaError = -9997;
pub const paInvalidDevice: PaError = -9996;
pub const paInvalidFlag: PaError = -9995;
pub const paSampleFormatNotSupported: PaError = -9994;
pub const paBadIODeviceCombination: PaError = -9993;
pub const paInsufficientMemory: PaError = -9992;
pub const paBufferTooBig: PaError = -9991;
pub const paBufferTooSmall: PaError = -9990;
pub const paNullCallback: PaError = -9989;
pub const paBadStreamPtr: PaError = -9988;
pub const paTimedOut: PaError = -9987;
pub const paInternalError: PaError = -9986;
pub const paDeviceUnavailable: PaError = -9985;
pub const paIncompatibleHostApiSpecificStreamInfo: PaError = -9984;
pub const paStreamIsStopped: PaError = -9983;
pub const paStreamIsNotStopped: PaError = -9982;
pub const paInputOverflowed: PaError = -9981;
pub const paOutputUnderflowed: PaError = -9980;
pub const paHostApiNotFound: PaError = -9979;
pub const paInvalidHostApi: PaError = -9978;
pub const paCanNotReadFromACallbackStream: PaError = -9977;
pub const paCanNotWriteToACallbackStream: PaError = -9976;
pub const paCanNotReadFromAnOutputOnlyStream: PaError = -9975;
pub const paCanNotWriteToAnInputOnlyStream: PaError = -9974;
pub const paIncompatibleStreamHostApi: PaError = -9973;
pub const paBadBufferPtr: PaError = -9972;
pub const paFormatIsSupported: PaError = 0;

// ─── Mac Core Audio ───────────────────────────────

pub const paMacCoreChangeDeviceParameters: u64 = 0x01;
pub const paMacCoreFailIfConversionRequired: u64 = 0x02;
pub const paMacCoreConversionQualityMin: u64 = 0x0100;
pub const paMacCoreConversionQualityMedium: u64 = 0x0200;
pub const paMacCoreConversionQualityLow: u64 = 0x0300;
pub const paMacCoreConversionQualityHigh: u64 = 0x0400;
pub const paMacCoreConversionQualityMax: u64 = 0x0000;

// ─── ASIO ─────────────────────────────────────────

pub const paAsioUseChannelSelectors: u64 = 0x01;

// ─── WASAPI ───────────────────────────────────────

pub const paWinWasapiExclusive: u64 = 1;
pub const paWinWasapiAutoConvert: u64 = 64;
pub const paWinWasapiExplicitSampleFormat: u64 = 32;

// ─── Structs ──────────────────────────────────────

#[repr(C)]
pub struct PaHostApiInfo {
    pub structVersion: i32,
    pub typ: PaHostApiTypeId,
    pub name: *const std::ffi::c_char,
    pub deviceCount: i32,
    pub defaultInputDevice: PaDeviceIndex,
    pub defaultOutputDevice: PaDeviceIndex,
}

pub type PaHostApiTypeId = i32;

#[repr(C)]
pub struct PaDeviceInfo {
    pub structVersion: i32,
    pub name: *const std::ffi::c_char,
    pub hostApi: PaHostApiIndex,
    pub maxInputChannels: i32,
    pub maxOutputChannels: i32,
    pub defaultLowInputLatency: PaTime,
    pub defaultLowOutputLatency: PaTime,
    pub defaultHighInputLatency: PaTime,
    pub defaultHighOutputLatency: PaTime,
    pub defaultSampleRate: f64,
}

#[repr(C)]
pub struct PaStreamParameters {
    pub device: PaDeviceIndex,
    pub channelCount: i32,
    pub sampleFormat: PaSampleFormat,
    pub suggestedLatency: PaTime,
    pub hostApiSpecificStreamInfo: *mut c_void,
}

#[repr(C)]
pub struct PaStreamCallbackTimeInfo {
    pub inputBufferAdcTime: PaTime,
    pub currentTime: PaTime,
    pub outputBufferDacTime: PaTime,
}

#[repr(C)]
pub struct PaStreamInfo {
    pub structVersion: i32,
    pub inputLatency: PaTime,
    pub outputLatency: PaTime,
    pub sampleRate: f64,
}

#[repr(C)]
pub struct PaHostErrorInfo {
    pub hostApiType: PaHostApiTypeId,
    pub errorCode: i64,
    pub errorText: *const std::ffi::c_char,
}

// ─── Opaque Types ─────────────────────────────────

pub enum PaStream {} // opaque

// ─── Callback Types ───────────────────────────────

pub type PaStreamCallback = Option<
    unsafe extern "C" fn(
        input: *const c_void,
        output: *mut c_void,
        frameCount: u64,
        timeInfo: *const PaStreamCallbackTimeInfo,
        statusFlags: PaStreamCallbackFlags,
        userData: *mut c_void,
    ) -> i32,
>;

pub type PaStreamFinishedCallback =
    Option<unsafe extern "C" fn(userData: *mut c_void)>;

// ─── FFI Declarations ─────────────────────────────

// Link the correct PortAudio binary per platform & architecture.
// Names match the files in portaudio-binaries/ exactly.
#[cfg_attr(all(target_os = "macos"), link(name = "libportaudio", kind = "dylib"))]
#[cfg_attr(all(target_os = "linux"), link(name = "libportaudio", kind = "dylib"))]
#[cfg_attr(
    all(target_os = "windows", target_arch = "x86_64"),
    link(name = "libportaudio64bit", kind = "raw-dylib")
)]
#[cfg_attr(
    all(target_os = "windows", target_arch = "aarch64"),
    link(name = "libportaudioarm64", kind = "raw-dylib")
)]
#[cfg_attr(
    all(target_os = "windows", target_arch = "x86"),
    link(name = "libportaudio32bit", kind = "raw-dylib")
)]
extern "C" {
    pub fn Pa_GetVersion() -> i32;
    pub fn Pa_GetVersionText() -> *const std::ffi::c_char;
    pub fn Pa_GetErrorText(errorCode: PaError) -> *const std::ffi::c_char;
    pub fn Pa_Initialize() -> PaError;
    pub fn Pa_Terminate() -> PaError;

    pub fn Pa_GetDeviceCount() -> PaDeviceIndex;
    pub fn Pa_GetDefaultInputDevice() -> PaDeviceIndex;
    pub fn Pa_GetDefaultOutputDevice() -> PaDeviceIndex;
    pub fn Pa_GetDeviceInfo(device: PaDeviceIndex) -> *const PaDeviceInfo;

    pub fn Pa_GetHostApiCount() -> PaHostApiIndex;
    pub fn Pa_GetDefaultHostApi() -> PaHostApiIndex;
    pub fn Pa_GetHostApiInfo(hostApi: PaHostApiIndex) -> *const PaHostApiInfo;
    pub fn Pa_HostApiTypeIdToHostApiIndex(typ: PaHostApiTypeId) -> PaHostApiIndex;
    pub fn Pa_HostApiDeviceIndexToDeviceIndex(
        hostApi: PaHostApiIndex,
        hostApiDeviceIndex: i32,
    ) -> PaDeviceIndex;

    pub fn Pa_GetLastHostErrorInfo() -> *const PaHostErrorInfo;

    pub fn Pa_IsFormatSupported(
        inputParameters: *const PaStreamParameters,
        outputParameters: *const PaStreamParameters,
        sampleRate: f64,
    ) -> PaError;

    pub fn Pa_OpenStream(
        stream: *mut *mut PaStream,
        inputParameters: *const PaStreamParameters,
        outputParameters: *const PaStreamParameters,
        sampleRate: f64,
        framesPerBuffer: u64,
        streamFlags: PaStreamFlags,
        streamCallback: PaStreamCallback,
        userData: *mut c_void,
    ) -> PaError;

    pub fn Pa_OpenDefaultStream(
        stream: *mut *mut PaStream,
        numInputChannels: i32,
        numOutputChannels: i32,
        sampleFormat: PaSampleFormat,
        sampleRate: f64,
        framesPerBuffer: u64,
        streamCallback: PaStreamCallback,
        userData: *mut c_void,
    ) -> PaError;

    pub fn Pa_CloseStream(stream: *mut PaStream) -> PaError;
    pub fn Pa_SetStreamFinishedCallback(
        stream: *mut PaStream,
        streamFinishedCallback: PaStreamFinishedCallback,
    ) -> PaError;
    pub fn Pa_StartStream(stream: *mut PaStream) -> PaError;
    pub fn Pa_StopStream(stream: *mut PaStream) -> PaError;
    pub fn Pa_AbortStream(stream: *mut PaStream) -> PaError;
    pub fn Pa_IsStreamStopped(stream: *mut PaStream) -> PaError;
    pub fn Pa_IsStreamActive(stream: *mut PaStream) -> PaError;

    pub fn Pa_GetStreamInfo(stream: *mut PaStream) -> *const PaStreamInfo;
    pub fn Pa_GetStreamTime(stream: *mut PaStream) -> PaTime;
    pub fn Pa_GetStreamCpuLoad(stream: *mut PaStream) -> f64;

    pub fn Pa_ReadStream(
        stream: *mut PaStream,
        buffer: *mut c_void,
        frames: u64,
    ) -> PaError;
    pub fn Pa_WriteStream(
        stream: *mut PaStream,
        buffer: *const c_void,
        frames: u64,
    ) -> PaError;
    pub fn Pa_GetStreamReadAvailable(stream: *mut PaStream) -> i64;
    pub fn Pa_GetStreamWriteAvailable(stream: *mut PaStream) -> i64;

    pub fn Pa_GetSampleSize(format: PaSampleFormat) -> PaError;
    pub fn Pa_Sleep(msec: i64);
}

// ─── Platform-specific (macOS only) ────────────────
// Separate extern block — only linked on macOS to avoid missing symbols on Windows/Linux.

#[cfg(target_os = "macos")]
#[link(name = "portaudio", kind = "dylib")]
extern "C" {
    pub fn PaMacCore_SetupStreamInfo(
        data: *mut PaMacCoreStreamInfo,
        flags: u64,
    );
    pub fn PaMacCore_SetupChannelMap(
        data: *mut PaMacCoreStreamInfo,
        channelMap: *const i32,
        channelMapSize: u64,
    );
    pub fn PaMacCore_GetChannelName(
        device: i32,
        channelIndex: i32,
        input: bool,
    ) -> *const std::ffi::c_char;
}

#[repr(C)]
pub struct PaMacCoreStreamInfo {
    pub size: u64,
    pub hostApiType: PaHostApiTypeId,
    pub version: u64,
    pub flags: u64,
    pub channelMap: *const i32,
    pub channelMapSize: u64,
}

#[repr(C)]
pub struct PaAsioStreamInfo {
    pub size: u64,
    pub hostApiType: PaHostApiTypeId,
    pub version: u64,
    pub flags: u64,
    pub channelSelectors: *mut i32,
}

#[repr(C)]
pub struct PaWasapiStreamInfo {
    pub size: u64,
    pub hostApiType: PaHostApiTypeId,
    pub version: u64,
    pub flags: u64,
    pub channelMask: u64,
    pub hostProcessorOutput: *mut c_void,
    pub hostProcessorInput: *mut c_void,
    pub threadPriority: i32,
    pub streamCategory: i32,
    pub streamOption: i32,
}
