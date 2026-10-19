//! Build script (Tauri codegen + two Windows-GNU test workarounds).
//!
//! `tauri_build` embeds an application manifest declaring the Common-Controls v6
//! assembly, which is what `tauri`/`wry` need: they import `TaskDialogIndirect`
//! and friends from `comctl32.dll`, and that entry point exists only in v6.
//! Without a manifest Windows binds `comctl32.dll` to the v5.82 copy in System32,
//! and the loader kills the process with `STATUS_ENTRYPOINT_NOT_FOUND`
//! (0xC0000139) before `main` — which is exactly what happens to test binaries,
//! because `tauri_build` only manifests the application target.
//!
//! So `cargo test` needs two things that `cargo build` gets for free:
//!   1. the same manifest, compiled with `windres` and linked into test binaries;
//!   2. `WebView2Loader.dll` next to the test executables (they live in
//!      `target/<profile>/deps/`, not next to the app binary).
//!
//! Both are best-effort: when a tool is missing the step is skipped silently, and
//! neither has any effect on a release build.

use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    tauri_build::build();

    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu")
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
    {
        link_manifest_into_tests();
    }
    copy_webview2_loader_for_tests();
}

/// Application manifest for test binaries: Common-Controls v6 + the compatibility
/// declarations, so that a test process loads the same system libraries the app does.
const MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df"
        language="*" />
    </dependentAssembly>
  </dependency>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <activeCodePage xmlns="http://schemas.microsoft.com/SMI/2019/WindowsSettings">UTF-8</activeCodePage>
    </windowsSettings>
  </application>
</assembly>
"#;

fn link_manifest_into_tests() {
    let Ok(out_dir) = std::env::var("OUT_DIR") else {
        return;
    };
    let out = PathBuf::from(&out_dir);
    let xml = out.join("boltlab-test.manifest");
    let rc = out.join("boltlab-test.manifest.rc");
    let obj = out.join("boltlab-test-manifest.o");

    // The resource script points at the manifest file by name, so both live in OUT_DIR.
    if std::fs::write(&xml, MANIFEST).is_err() {
        println!("cargo:warning=无法写入测试清单文件，测试可执行文件可能无法启动");
        return;
    }
    if std::fs::write(&rc, "1 24 \"boltlab-test.manifest\"\n").is_err() {
        return;
    }

    let status = Command::new("windres")
        .arg("--input")
        .arg(&rc)
        .arg("--output")
        .arg(&obj)
        .arg("--output-format")
        .arg("coff")
        .current_dir(&out)
        .status();

    match status {
        Ok(s) if s.success() => {
            // Applies to unit, integration and doc test targets.
            println!("cargo:rustc-link-arg-tests={}", obj.display());
        }
        _ => println!(
            "cargo:warning=未找到 windres：测试可执行文件将缺少 Common-Controls v6 清单，\
             在 windows-gnu 上可能无法启动（cargo build 不受影响）"
        ),
    }
}

fn copy_webview2_loader_for_tests() {
    let Ok(out_dir) = std::env::var("OUT_DIR") else {
        return;
    };
    // OUT_DIR is `target/<profile>/build/boltlab-app-<hash>/out`; the loader is
    // produced by a sibling build directory of the webview2-com-sys crate.
    let Some(build_dir) = Path::new(&out_dir).ancestors().nth(2) else {
        return;
    };
    let Some(profile_dir) = build_dir.parent() else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(build_dir) else {
        return;
    };

    let mut source: Option<PathBuf> = None;
    for entry in entries.flatten() {
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with("webview2-com-sys-")
        {
            continue;
        }
        let candidate = entry
            .path()
            .join("out")
            .join("x64")
            .join("WebView2Loader.dll");
        if candidate.exists() {
            source = Some(candidate);
            break;
        }
    }

    let Some(source) = source else { return };
    for target_dir in [profile_dir.to_path_buf(), profile_dir.join("deps")] {
        if !target_dir.exists() {
            continue;
        }
        let dest = target_dir.join("WebView2Loader.dll");
        if dest.exists() {
            continue;
        }
        let _ = std::fs::copy(&source, &dest);
    }
}
