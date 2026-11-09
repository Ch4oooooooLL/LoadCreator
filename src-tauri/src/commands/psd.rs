//! Tauri commands for PSD spectrum file import and standard template export.

use std::fs;
use std::path::{Path, PathBuf};

use crate::core::psd_import::{self, ImportedSpectrum};

fn extension_of(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// Read a CSV / TXT / XLSX spectrum file from disk and return the recognised
/// frequency / PSD points. The frontend lets the user review the points before
/// they are used to build a deck.
#[tauri::command]
pub fn read_psd_spectrum_file(path: String) -> Result<ImportedSpectrum, String> {
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
            let mut result = psd_import::parse_spreadsheet_path(p)?;
            result.source_kind = if ext == "ods" { "ods".into() } else { "xlsx".into() };
            Ok(result)
        }
        "csv" | "tsv" | "txt" | "dat" | "prn" | "" => {
            let bytes = fs::read(p).map_err(|e| format!("读取文件失败：{e}"))?;
            let text = psd_import::decode_bytes(&bytes);
            let mut result = psd_import::parse_spectrum_text(&text);
            result.source_kind = if ext == "csv" { "csv".into() } else { "txt".into() };
            Ok(result)
        }
        other => Err(format!(
            "不支持的文件类型 .{other}；请使用 CSV / TXT / XLSX 文件"
        )),
    }
}

/// Return the standard CSV template text (UTF-8 with BOM).
#[tauri::command]
pub fn psd_template_csv() -> String {
    psd_import::template_csv()
}

/// Write the standard PSD spectrum template to a user-chosen path.
/// format = "xlsx" writes a real Excel workbook, anything else writes CSV.
#[tauri::command]
pub fn write_psd_template(path: String, format: String) -> Result<String, String> {
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err("保存目录不存在".into());
        }
    }
    let fmt = format.to_ascii_lowercase();
    match fmt.as_str() {
        "xlsx" | "excel" => {
            let bytes = psd_import::template_xlsx_bytes()?;
            fs::write(&target, bytes).map_err(|e| format!("写入模板失败：{e}"))?;
        }
        _ => {
            fs::write(&target, psd_import::template_csv())
                .map_err(|e| format!("写入模板失败：{e}"))?;
        }
    }
    Ok(target.to_string_lossy().into_owned())
}
