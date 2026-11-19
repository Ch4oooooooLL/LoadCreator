//! Radioss `/FUNCT` curve import and tabular format (CSV / Excel XLSX) export.
//!
//! Supports the PPT requirement "Radioss Functions，输出表格格式" by:
//! 1. Importing `(X, Y)` points from CSV / TXT / XLSX / ODS or Excel clipboard text.
//! 2. Rendering generated `/FUNCT` curves into structured CSV and multi-sheet XLSX tables.

use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::core::psd_import::{
    data_to_string, detect_delimiter, detect_index_column, normalize_header, numeric_cells,
    parse_number_cell, split_fields,
};
use crate::core::radioss_deck::{RadiossDeck, StarterCard};
use crate::core::radioss_spec::RadiossCurvePoint;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedRadiossCurve {
    pub points: Vec<RadiossCurvePoint>,
    pub warnings: Vec<String>,
    pub ignored_lines: usize,
    pub source_kind: String,
    pub header: Option<String>,
    pub sheet_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossFunctionExportRow {
    pub id: u64,
    pub title: String,
    #[serde(default)]
    pub role: String,
    #[serde(default = "default_x_label")]
    pub x_label: String,
    #[serde(default = "default_y_label")]
    pub y_label: String,
    pub points: Vec<RadiossCurvePoint>,
}

fn default_x_label() -> String {
    "X (Time)".into()
}
fn default_y_label() -> String {
    "Y (Value)".into()
}

fn is_x_header(cell: &str) -> bool {
    let n = normalize_header(cell);
    if n.is_empty() {
        return false;
    }
    n.starts_with("时间")
        || n.starts_with("time")
        || n.starts_with("应变")
        || n.starts_with("strain")
        || matches!(
            n.as_str(),
            "x" | "t" | "tms" | "ts" | "x轴" | "横轴" | "横坐标" | "x坐标" | "xi" | "abscissa"
        )
}

fn is_y_header(cell: &str) -> bool {
    let n = normalize_header(cell);
    if n.is_empty() {
        return false;
    }
    n.starts_with("位移")
        || n.starts_with("disp")
        || n.starts_with("加速度")
        || n.starts_with("accel")
        || n.starts_with("重力")
        || n.starts_with("grav")
        || n.starts_with("系数")
        || n.starts_with("比例")
        || n.starts_with("幅值")
        || n.starts_with("数值")
        || n.starts_with("应力")
        || n.starts_with("stress")
        || n.starts_with("force")
        || n.starts_with("scale")
        || matches!(
            n.as_str(),
            "y" | "u" | "v" | "val" | "value" | "y轴" | "纵轴" | "纵坐标" | "y坐标" | "yi" | "ordinate"
        )
}

struct CurveGridOutcome {
    points: Vec<RadiossCurvePoint>,
    warnings: Vec<String>,
    ignored_lines: usize,
    header: Option<String>,
}

fn parse_curve_grid(grid: &[Vec<String>]) -> CurveGridOutcome {
    let mut warnings: Vec<String> = Vec::new();
    let mut ignored = 0usize;

    let mut header_row: Option<usize> = None;
    let mut x_col = 0usize;
    let mut y_col = 0usize;
    for (r, row) in grid.iter().enumerate() {
        let mut x: Option<usize> = None;
        let mut y: Option<usize> = None;
        for (c, cell) in row.iter().enumerate() {
            if x.is_none() && is_x_header(cell) {
                x = Some(c);
                continue;
            }
            if y.is_none() && is_y_header(cell) {
                y = Some(c);
            }
        }
        if let (Some(xc), Some(yc)) = (x, y) {
            if xc != yc {
                header_row = Some(r);
                x_col = xc;
                y_col = yc;
                break;
            }
        }
    }

    let mut points = Vec::new();
    let mut header_desc = None;

    if let Some(h) = header_row {
        let cells: Vec<String> = grid[h]
            .iter()
            .filter(|c| !c.trim().is_empty())
            .map(|c| c.trim().to_string())
            .collect();
        if !cells.is_empty() {
            header_desc = Some(cells.join(" | "));
        }
        for (r, row) in grid.iter().enumerate().skip(h + 1) {
            if row.iter().any(|c| is_x_header(c)) && row.iter().any(|c| is_y_header(c)) {
                continue;
            }
            let xcell = row.get(x_col).map(String::as_str).unwrap_or("");
            let ycell = row.get(y_col).map(String::as_str).unwrap_or("");
            if xcell.trim().is_empty() && ycell.trim().is_empty() {
                continue;
            }
            match (parse_number_cell(xcell), parse_number_cell(ycell)) {
                (Some(time), Some(value)) => points.push(RadiossCurvePoint { time, value }),
                _ => {
                    ignored += 1;
                    if warnings.len() < 20 {
                        warnings.push(format!("第 {} 行无法解析 X/Y 数值，已跳过", r + 1));
                    }
                }
            }
        }
    } else {
        let candidates: Vec<(usize, Vec<(usize, f64)>)> = grid
            .iter()
            .enumerate()
            .filter_map(|(r, row)| {
                let nums = numeric_cells(row);
                if nums.len() >= 2 {
                    Some((r, nums))
                } else {
                    None
                }
            })
            .collect();

        if candidates.is_empty() {
            return CurveGridOutcome {
                points,
                warnings: vec![
                    "未识别到 X / Y 曲线数据行。请确认包含两列数值，或带标准表头（时间 / 位移 或 X / Y）。"
                        .into(),
                ],
                ignored_lines: 0,
                header: None,
            };
        }

        let has_index = detect_index_column(&candidates);
        if has_index {
            warnings.push("未找到表头，已自动跳过首列序号。".into());
        } else {
            warnings.push(format!(
                "未找到表头，按前两列数值识别为“X、Y”，共 {} 个数据点。",
                candidates.len()
            ));
        }
        for (r, nums) in &candidates {
            let pair = if has_index {
                if nums.len() >= 3 {
                    Some((nums[1].1, nums[2].1))
                } else {
                    None
                }
            } else {
                Some((nums[0].1, nums[1].1))
            };
            match pair {
                Some((time, value)) => points.push(RadiossCurvePoint { time, value }),
                None => {
                    ignored += 1;
                    if warnings.len() < 20 {
                        warnings.push(format!("第 {} 行列数不足，已跳过", r + 1));
                    }
                }
            }
        }
        let candidate_rows: HashSet<usize> = candidates.iter().map(|(r, _)| *r).collect();
        for (r, row) in grid.iter().enumerate() {
            if candidate_rows.contains(&r) {
                continue;
            }
            if row.iter().any(|c| !c.trim().is_empty()) {
                ignored += 1;
            }
        }
    }

    let mut prev: Option<f64> = None;
    for (i, p) in points.iter().enumerate() {
        if let Some(pv) = prev {
            if !(p.time > pv) && warnings.len() < 40 {
                warnings.push(format!(
                    "第 {} 点横坐标 {} 未严格大于前一点 {}",
                    i + 1,
                    p.time,
                    pv
                ));
            }
        }
        prev = Some(p.time);
    }

    CurveGridOutcome {
        points,
        warnings,
        ignored_lines: ignored,
        header: header_desc,
    }
}

pub fn parse_radioss_curve_text(text: &str) -> ImportedRadiossCurve {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.lines().collect();
    let delimiter = detect_delimiter(&lines);

    let mut grid: Vec<Vec<String>> = Vec::new();
    for line in &lines {
        let trimmed = line.trim().trim_start_matches('\u{feff}').trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("//") {
            continue;
        }
        let mut fields: Vec<String> = split_fields(trimmed, delimiter)
            .into_iter()
            .map(|s| s.trim().to_string())
            .collect();
        while fields.last().map(|s| s.is_empty()).unwrap_or(false) {
            fields.pop();
        }
        if !fields.is_empty() {
            grid.push(fields);
        }
    }

    let outcome = parse_curve_grid(&grid);
    ImportedRadiossCurve {
        points: outcome.points,
        warnings: outcome.warnings,
        ignored_lines: outcome.ignored_lines,
        source_kind: "txt".into(),
        header: outcome.header,
        sheet_name: None,
    }
}

pub fn parse_radioss_curve_spreadsheet(path: &Path) -> Result<ImportedRadiossCurve, String> {
    use calamine::{open_workbook_auto, Reader};

    let mut workbook = open_workbook_auto(path).map_err(|e| format!("无法打开表格文件：{e}"))?;
    let sheet_names = workbook.sheet_names().to_vec();
    let mut best: Option<ImportedRadiossCurve> = None;
    let mut errors: Vec<String> = Vec::new();

    for name in sheet_names {
        let range = match workbook.worksheet_range(&name) {
            Ok(r) => r,
            Err(e) => {
                errors.push(format!("工作表“{name}”读取失败：{e}"));
                continue;
            }
        };
        let mut grid: Vec<Vec<String>> = Vec::new();
        for row in range.rows() {
            let cells: Vec<String> = row.iter().map(data_to_string).collect();
            if cells.iter().any(|c| !c.trim().is_empty()) {
                grid.push(cells);
            }
        }
        if grid.is_empty() {
            continue;
        }
        let outcome = parse_curve_grid(&grid);
        if outcome.points.is_empty() {
            errors.push(format!("工作表“{name}”未识别到曲线点"));
            continue;
        }
        let candidate = ImportedRadiossCurve {
            points: outcome.points,
            warnings: outcome.warnings,
            ignored_lines: outcome.ignored_lines,
            source_kind: "xlsx".into(),
            header: outcome.header,
            sheet_name: Some(name),
        };
        if best
            .as_ref()
            .is_none_or(|cur| candidate.points.len() > cur.points.len())
        {
            best = Some(candidate);
        }
    }

    best.ok_or_else(|| {
        if errors.is_empty() {
            "工作簿中没有可读取的工作表".into()
        } else {
            format!("未在任何工作表中识别到曲线数据（{}）", errors.join("；"))
        }
    })
}

fn csv_escape(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Extract all `/FUNCT` definitions from a generated `RadiossDeck` in deterministic order.
pub fn extract_functions_from_deck(deck: &RadiossDeck) -> Vec<RadiossFunctionExportRow> {
    let displacement_functions: HashSet<u64> = deck.starter.iter().filter_map(|card| match card {
        StarterCard::ImposedDisplacement { function_id, .. } => Some(*function_id),
        _ => None,
    }).collect();
    let gravity_functions: HashSet<u64> = deck.starter.iter().filter_map(|card| match card {
        StarterCard::Gravity { function_id, .. } => Some(*function_id),
        _ => None,
    }).collect();
    deck.starter
        .iter()
        .filter_map(|card| match card {
            StarterCard::Function { id, title, points } => {
                let role = if displacement_functions.contains(id) {
                    "受控位移曲线 (/IMPDISP)"
                } else if gravity_functions.contains(id) {
                    "重力加载曲线 (/GRAV)"
                } else {
                    "自定义曲线 (/FUNCT)"
                };
                Some(RadiossFunctionExportRow {
                    id: *id,
                    title: title.clone(),
                    role: role.into(),
                    x_label: "X (Time)".into(),
                    y_label: "Y (Value)".into(),
                    points: points
                        .iter()
                        .map(|(time, value)| RadiossCurvePoint {
                            time: *time,
                            value: *value,
                        })
                        .collect(),
                })
            }
            _ => None,
        })
        .collect()
}

/// Render all Radioss `/FUNCT` curves into a UTF-8 BOM CSV table.
pub fn render_functions_csv(functions: &[RadiossFunctionExportRow]) -> String {
    let mut out = String::from("\u{feff}");
    out.push_str("Function_ID,Function_Title,Role,Point_Index,X,Y\n");
    for f in functions {
        for (idx, pt) in f.points.iter().enumerate() {
            out.push_str(&format!(
                "{},{},{},{},{},{}\n",
                f.id,
                csv_escape(&f.title),
                csv_escape(&f.role),
                idx + 1,
                pt.time,
                pt.value
            ));
        }
    }
    out
}

fn sanitize_sheet_name(raw: &str, fallback: &str, used: &mut HashSet<String>) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if matches!(c, '\\' | '/' | '?' | '*' | '[' | ']' | ':') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let base: String = cleaned.trim().chars().take(28).collect();
    let base = if base.is_empty() {
        fallback.to_string()
    } else {
        base
    };
    let mut name = base.clone();
    let mut suffix = 2usize;
    while used.contains(&name) {
        let tag = format!("_{suffix}");
        let prefix: String = base.chars().take(31usize.saturating_sub(tag.len())).collect();
        name = format!("{prefix}{tag}");
        suffix += 1;
    }
    used.insert(name.clone());
    name
}

/// Render all Radioss `/FUNCT` curves into a multi-sheet Excel `.xlsx` workbook.
pub fn render_functions_xlsx_bytes(functions: &[RadiossFunctionExportRow]) -> Result<Vec<u8>, String> {
    use rust_xlsxwriter::{Format, Workbook};

    let mut workbook = Workbook::new();
    let bold = Format::new().set_bold();

    // Sheet 1: Combined summary table
    {
        let summary = workbook.add_worksheet();
        summary
            .set_name("Radioss_Functions_汇总")
            .map_err(|e| format!("创建汇总页失败：{e}"))?;
        let headers = ["Function_ID", "Function_Title", "用途", "序号", "X", "Y"];
        for (col, h) in headers.iter().enumerate() {
            summary
                .write_string_with_format(0, col as u16, *h, &bold)
                .map_err(|e| e.to_string())?;
        }
        let mut row_idx = 1u32;
        for f in functions {
            for (pt_idx, pt) in f.points.iter().enumerate() {
                summary
                    .write_number(row_idx, 0, f.id as f64)
                    .map_err(|e| e.to_string())?;
                summary
                    .write_string(row_idx, 1, &f.title)
                    .map_err(|e| e.to_string())?;
                summary
                    .write_string(row_idx, 2, &f.role)
                    .map_err(|e| e.to_string())?;
                summary
                    .write_number(row_idx, 3, (pt_idx + 1) as f64)
                    .map_err(|e| e.to_string())?;
                summary
                    .write_number(row_idx, 4, pt.time)
                    .map_err(|e| e.to_string())?;
                summary
                    .write_number(row_idx, 5, pt.value)
                    .map_err(|e| e.to_string())?;
                row_idx += 1;
            }
        }
    }

    // Individual 2-column sheets for direct copy/import into HyperMesh Curve Editor
    let mut used_names = HashSet::from(["Radioss_Functions_汇总".to_string()]);
    for (idx, f) in functions.iter().enumerate() {
        let sheet_title = sanitize_sheet_name(
            &format!("{}_{}", f.id, f.title),
            &format!("FUNCT_{}", idx + 1),
            &mut used_names,
        );
        let sheet = workbook.add_worksheet();
        sheet
            .set_name(&sheet_title)
            .map_err(|e| format!("创建函数工作表失败：{e}"))?;
        sheet
            .write_string_with_format(0, 0, &f.x_label, &bold)
            .map_err(|e| e.to_string())?;
        sheet
            .write_string_with_format(0, 1, &f.y_label, &bold)
            .map_err(|e| e.to_string())?;
        for (i, pt) in f.points.iter().enumerate() {
            sheet
                .write_number((i + 1) as u32, 0, pt.time)
                .map_err(|e| e.to_string())?;
            sheet
                .write_number((i + 1) as u32, 1, pt.value)
                .map_err(|e| e.to_string())?;
        }
    }

    workbook
        .save_to_buffer()
        .map_err(|e| format!("生成 Excel 表格失败：{e}"))
}
