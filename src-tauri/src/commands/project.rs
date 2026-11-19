//! Project (.lccase.json) persistence and legacy workspace migration.

use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};

fn slug(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "project".into()
    } else {
        trimmed
    }
}

#[tauri::command]
pub fn save_project(path: String, document: Value) -> Result<String, String> {
    let target = PathBuf::from(&path);
    let Some(parent) = target.parent() else {
        return Err("工程保存路径无效".into());
    };
    if !parent.is_dir() {
        return Err("工程保存目录不存在".into());
    }
    let text =
        serde_json::to_string_pretty(&document).map_err(|e| format!("序列化工程失败：{e}"))?;
    // Write to a temp file then rename for atomicity where possible.
    let tmp = target.with_extension("lccase.json.tmp");
    fs::write(&tmp, text).map_err(|e| format!("写入临时工程失败：{e}"))?;
    fs::rename(&tmp, &target).map_err(|e| format!("替换工程文件失败：{e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_project(path: String) -> Result<Value, String> {
    let text = fs::read_to_string(&path).map_err(|e| format!("读取工程失败：{e}"))?;
    let value: Value =
        serde_json::from_str(&text).map_err(|e| format!("解析工程 JSON 失败：{e}"))?;
    Ok(value)
}

/// Migrate a legacy `loaddeck.workspace.v1` payload into a schemaVersion 2
/// project document. The original payload is embedded, never discarded.
pub fn migrate_legacy_workspace(legacy: &Value) -> Value {
    let project_name = legacy
        .get("projectName")
        .and_then(Value::as_str)
        .unwrap_or("LoadCreator 工程");
    let rows = legacy.get("rows").cloned().unwrap_or_else(|| json!([]));
    let case_aliases = legacy
        .get("caseAliases")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let source = legacy.get("source").cloned().unwrap_or(Value::Null);
    json!({
        "schemaVersion": 2,
        "application": "LoadCreator",
        "projectId": slug(project_name),
        "projectName": project_name,
        "solverTarget": { "name": "optistruct", "version": "2022" },
        "modelUnits": "N-mm-s",
        "idPolicy": { "kind": "project-managed" },
        "cases": [{
            "caseKey": "case-tabular-1",
            "name": project_name,
            "spec": {
                "kind": "tabular-load",
                "parameters": {
                    "projectName": project_name,
                    "rows": rows,
                    "caseAliases": case_aliases,
                    "coordinateTolerance": 1e-6,
                    "legacySource": source
                }
            }
        }],
        "idAssignments": {},
        "appSettings": { "exportProfile": "hypermesh-increment" },
        "legacyBackup": legacy.clone()
    })
}

#[tauri::command]
pub fn migrate_legacy_workspace_cmd(legacy: Value) -> Value {
    migrate_legacy_workspace(&legacy)
}

#[tauri::command]
pub fn save_text_file(path: String, content: String) -> Result<String, String> {
    let target = PathBuf::from(&path);
    let Some(parent) = target.parent() else {
        return Err("模板保存路径无效".into());
    };
    if !parent.is_dir() {
        return Err("模板保存目录不存在".into());
    }
    let file_name = target
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("template");
    let tmp = parent.join(format!(".{file_name}.tmp"));
    fs::write(&tmp, content).map_err(|e| format!("写入临时模板文件失败：{e}"))?;
    if let Err(err) = fs::rename(&tmp, &target) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("保存模板文件失败：{err}"));
    }
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let text = fs::read_to_string(&path).map_err(|e| format!("读取模板文件失败：{e}"))?;
    Ok(text.strip_prefix('\u{FEFF}').unwrap_or(&text).to_string())
}
