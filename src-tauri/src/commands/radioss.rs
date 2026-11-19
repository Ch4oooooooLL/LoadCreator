//! Tauri commands for Radioss `/FUNCT` curve import and tabular format export.

use std::fs;
use std::path::{Path, PathBuf};

use crate::core::psd_import::decode_bytes;
use crate::core::radioss_functions_io::{
    self, ImportedRadiossCurve, RadiossFunctionExportRow,
};

fn extension_of(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// Read a CSV / TXT / XLSX Radioss curve file `(X, Y)` from disk.
#[tauri::command]
pub fn read_radioss_curve_file(path: String) -> Result<ImportedRadiossCurve, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在：{path}"));
    }
    if !p.is_file() {
        return Err("所选路径不是文件".into());
    }
    let ext = extension_of(&path);
    match ext.as_str() {
        "xlsx" | "xlsm" | "xlam" | "xlsb" | "xls" | "xla" | "ods" => {
            let mut result = radioss_functions_io::parse_radioss_curve_spreadsheet(p)?;
            result.source_kind = if ext == "ods" { "ods".into() } else { "xlsx".into() };
            Ok(result)
        }
        "csv" | "tsv" | "txt" | "dat" | "prn" | "" => {
            let bytes = fs::read(p).map_err(|e| format!("读取文件失败：{e}"))?;
            let text = decode_bytes(&bytes);
            let mut result = radioss_functions_io::parse_radioss_curve_text(&text);
            result.source_kind = if ext == "csv" { "csv".into() } else { "txt".into() };
            Ok(result)
        }
        other => Err(format!(
            "不支持的文件类型 .{other}；请使用 CSV / TXT / XLSX 文件"
        )),
    }
}

/// Export Radioss Functions into tabular CSV or Excel XLSX format.
#[tauri::command]
pub fn export_radioss_functions_table(
    path: String,
    format: String,
    functions: Vec<RadiossFunctionExportRow>,
) -> Result<String, String> {
    if functions.is_empty() {
        return Err("当前没有可导出的 Radioss Functions 曲线".into());
    }
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err("保存目录不存在".into());
        }
    }
    let fmt = format.to_ascii_lowercase();
    match fmt.as_str() {
        "xlsx" | "excel" => {
            let bytes = radioss_functions_io::render_functions_xlsx_bytes(&functions)?;
            fs::write(&target, bytes).map_err(|e| format!("写入 Excel 表格失败：{e}"))?;
        }
        _ => {
            let csv = radioss_functions_io::render_functions_csv(&functions);
            fs::write(&target, csv).map_err(|e| format!("写入 CSV 表格失败：{e}"))?;
        }
    }
    Ok(target.to_string_lossy().into_owned())
}
