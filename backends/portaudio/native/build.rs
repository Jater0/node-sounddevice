extern crate napi_build;

fn main() {
    napi_build::setup();

    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-search=native=portaudio-binaries");
        println!("cargo:rustc-link-lib=dylib=portaudio");
    }

    #[cfg(target_os = "linux")]
    {
        println!("cargo:rustc-link-lib=dylib=portaudio");
    }

    #[cfg(target_os = "windows")]
    {
        // raw-dylib needs the DLL named "portaudio.dll" at link time
        println!("cargo:rustc-link-search=native=portaudio-binaries");

        // Copy the right DLL as "portaudio.dll" to the output directory
        let target = std::env::var("TARGET").unwrap_or_default();
        let dll_name = if target.contains("aarch64") {
            "libportaudioarm64.dll"
        } else {
            "libportaudio64bit.dll"
        };

        let src = format!("portaudio-binaries/{}", dll_name);
        let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".into());
        let dest = format!("../../target/{}", profile);
        std::fs::copy(&src, format!("{}/portaudio.dll", dest)).ok();
        // Also copy as portaudio.dll in the search path for the linker
        std::fs::copy(&src, "portaudio-binaries/portaudio.dll").ok();
    }
}
