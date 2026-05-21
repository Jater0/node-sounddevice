extern crate napi_build;

fn main() {
    napi_build::setup();

    // Link PortAudio library
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-search=native=portaudio-binaries");
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-lib=dylib=portaudio");

    #[cfg(target_os = "linux")]
    println!("cargo:rustc-link-lib=dylib=portaudio");

    #[cfg(target_os = "windows")]
    {
        // Windows: copy DLL to output directory at build time
        // (exact DLL path resolved at runtime via path detection)
        println!("cargo:rustc-link-lib=dylib=portaudio");
    }
}
