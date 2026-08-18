fn main() {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    println!("cargo:rustc-env=BUILD_TIME={ts}");
    println!("cargo:rerun-if-changed=build.rs");

    // Windows version-info resource: this is what the OS shows in firewall
    // permission dialogs, Task Manager's Name column, and file Properties.
    #[cfg(target_os = "windows")]
    {
        let mut res = winresource::WindowsResource::new();
        res.set("FileDescription", "Pavii.Ai Engine");
        res.set("ProductName", "Pavii.Ai");
        res.set("CompanyName", "Team Pavii");
        res.set("LegalCopyright", "Copyright \u{00A9} 2026 Team Pavii");
        res.set("OriginalFilename", "aioncore.exe");
        res.set("InternalName", "aioncore");
        res.set_icon("assets/app.ico");
        if let Err(error) = res.compile() {
            println!("cargo:warning=failed to embed Windows version info: {error}");
        }
        println!("cargo:rerun-if-changed=assets/app.ico");
    }
}
