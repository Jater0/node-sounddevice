extern crate napi_build;

fn main() {
    napi_build::setup();

    #[cfg(target_os = "macos")]
    {
        // Link against bundled libportaudio.dylib
        println!("cargo:rustc-link-search=native=portaudio-binaries");

        // Copy the dylib to the output directory for runtime
        let src = "portaudio-binaries/libportaudio.dylib";
        let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".into());
        let dest = format!("../../target/{}", profile);
        std::fs::copy(src, format!("{}/libportaudio.dylib", dest)).ok();
    }

    #[cfg(target_os = "linux")]
    {
        // Linux uses system PortAudio via pkg-config or standard paths.
        // The user must install libportaudio2 before building.
        println!("cargo:rustc-link-lib=dylib=portaudio");
    }

    #[cfg(target_os = "windows")]
    {
        // raw-dylib needs to find the DLL at link time
        println!("cargo:rustc-link-search=native=portaudio-binaries");

        // Copy the right DLL to the output directory for runtime
        let target = std::env::var("TARGET").unwrap_or_default();
        let dll_name = if target.contains("aarch64") {
            "libportaudioarm64.dll"
        } else if target.contains("x86_64") {
            "libportaudio64bit.dll"
        } else {
            "libportaudio32bit.dll"
        };

        let src = format!("portaudio-binaries/{}", dll_name);
        let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".into());
        let dest = format!("../../target/{}", profile);
        std::fs::copy(&src, format!("{}/{}", dest, dll_name)).ok();
        std::fs::copy(&src, dll_name).ok();
    }
}
