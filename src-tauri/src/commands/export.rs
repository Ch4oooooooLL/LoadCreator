//! Export a BuildResultV2 file map to a user-chosen directory.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[tauri::command]
pub fn export_case_files(
    directory: String,
    base_name: String,
    files: BTreeMap<String, String>,
) -> Result<Vec<String>, String> {
    let dir = Path::new(&directory);
    if !dir.is_dir() {
        return Err("导出目录不存在".into());
    }
    let _ = base_name;
    let mut written = Vec::new();
    for (name, content) in files {
        if name.is_empty() || name.contains("..") || name.contains('/') || name.contains('\\') {
            return Err(format!("非法输出文件名：{name}"));
        }
        let target = dir.join(&name);
        fs::write(&target, content).map_err(|e| format!("写入 {name} 失败：{e}"))?;
        written.push(target.to_string_lossy().into_owned());
    }
    Ok(written)
}
