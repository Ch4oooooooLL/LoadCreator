use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

const NODE_ID_START: u64 = 1001;
const LOAD_ID_START: u64 = 100_001;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoadRow {
    pub source_line: usize,
    pub case_name: String,
    pub group_name: String,
    pub point_name: String,
    pub display_name: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub time: Option<f64>,
    pub fx: f64,
    pub fy: f64,
    pub fz: f64,
    pub tx: f64,
    pub ty: f64,
    pub tz: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WarningSeverity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WarningTargetKind {
    SourceLine,
    DataCell,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WarningTarget {
    pub kind: WarningTargetKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_line: Option<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoadDeckWarning {
    pub code: String,
    pub severity: WarningSeverity,
    pub category: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub targets: Vec<WarningTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseResult {
    pub rows: Vec<LoadRow>,
    pub warnings: Vec<String>,
    #[serde(default)]
    pub warning_items: Vec<LoadDeckWarning>,
    pub ignored_lines: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildRequest {
    pub project_name: String,
    pub rows: Vec<LoadRow>,
    #[serde(default)]
    pub case_aliases: BTreeMap<String, String>,
    #[serde(default = "default_tolerance")]
    pub coordinate_tolerance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateRowsRequest {
    pub rows: Vec<LoadRow>,
    #[serde(default = "default_tolerance")]
    pub coordinate_tolerance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateRowsResult {
    pub warnings: Vec<String>,
    #[serde(default)]
    pub warning_items: Vec<LoadDeckWarning>,
}

fn default_tolerance() -> f64 {
    1e-6
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointEntry {
    pub node_id: u64,
    pub name: String,
    pub english_name: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseSummary {
    pub name: String,
    pub fem_name: String,
    pub collector_name: String,
    pub load_step_name: String,
    pub load_id: u64,
    pub row_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    pub fem: String,
    pub json: String,
    pub points: Vec<PointEntry>,
    pub cases: Vec<CaseSummary>,
    pub warnings: Vec<String>,
    #[serde(default)]
    pub warning_items: Vec<LoadDeckWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub fem_path: String,
    pub json_path: String,
}

#[derive(Default, Clone, Copy)]
struct Columns {
    group: Option<usize>,
    x: Option<usize>,
    y: Option<usize>,
    z: Option<usize>,
    point: Option<usize>,
    display: Option<usize>,
    time: Option<usize>,
    fx: Option<usize>,
    fy: Option<usize>,
    fz: Option<usize>,
    tx: Option<usize>,
    ty: Option<usize>,
    tz: Option<usize>,
}

impl Columns {
    fn ready(self) -> bool {
        [self.x, self.y, self.z, self.fx, self.fy, self.fz]
            .iter()
            .all(Option::is_some)
    }
}

fn clean(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim()
        .replace('\u{feff}', "")
}

fn norm(value: &str) -> String {
    clean(value)
        .to_lowercase()
        .replace([' ', '_', '-', '/', '（', '）', '(', ')'], "")
}

fn parse_number(value: Option<&&str>) -> Option<f64> {
    let raw = clean(value.copied().unwrap_or_default());
    if raw.is_empty() || matches!(raw.as_str(), "-" | "—" | "/") {
        return Some(0.0);
    }
    raw.replace(',', "").parse::<f64>().ok()
}

fn find_col(cells: &[&str], aliases: &[&str]) -> Option<usize> {
    // Normalise both sides so headers such as "中文名称" and aliases like
    // "中文名" match regardless of spacing, case or punctuation.
    let normalised: Vec<String> = aliases.iter().map(|alias| norm(alias)).collect();
    cells.iter().position(|cell| {
        let value = norm(cell);
        normalised.iter().any(|alias| &value == alias)
    })
}

fn header_columns(cells: &[&str]) -> Option<Columns> {
    let fx = find_col(cells, &["fx", "forcex", "x向力", "纵向力"])?;
    let fy = find_col(cells, &["fy", "forcey", "y向力", "侧向力"]);
    let fz = find_col(cells, &["fz", "forcez", "z向力", "垂向力"]);
    if fy.is_none() || fz.is_none() {
        return None;
    }

    let mut cols = Columns {
        group: find_col(cells, &["group", "system", "分组", "系统", "组别", "总成"]),
        x: find_col(cells, &["x", "coordx", "xcoord", "x坐标", "坐标x", "x值"]),
        y: find_col(cells, &["y", "coordy", "ycoord", "y坐标", "坐标y", "y值"]),
        z: find_col(cells, &["z", "coordz", "zcoord", "z坐标", "坐标z", "z值"]),
        point: find_col(
            cells,
            &[
                "name",
                "point",
                "pointname",
                "englishname",
                "english",
                "英文",
                "英文名",
                "英文名称",
                "英文点位名",
                "英文点位名称",
            ],
        ),
        display: find_col(
            cells,
            &[
                "displayname",
                "description",
                "desc",
                "中文名",
                "中文名称",
                "中文点位名",
                "中文点位名称",
                "点位名",
                "点位名称",
                "落点名称",
                "名称",
                "部件",
                "部件名称",
                "零件名称",
                "节点名称",
            ],
        ),
        time: find_col(cells, &["time", "时间", "时刻", "时间(s)", "time(s)"]),
        fx: Some(fx),
        fy,
        fz,
        tx: find_col(cells, &["tx", "mx", "momentx", "扭矩x", "力矩x"]),
        ty: find_col(cells, &["ty", "my", "momenty", "扭矩y", "力矩y"]),
        tz: find_col(cells, &["tz", "mz", "momentz", "扭矩z", "力矩z"]),
    };

    // Merged spreadsheet headers often name the coordinate block only once.
    // For the common layout, infer the seven fields immediately before FX:
    // X Y Z EnglishName DisplayName Sequence Time.
    if (cols.x.is_none() || cols.y.is_none() || cols.z.is_none()) && fx >= 7 {
        cols.x = Some(fx - 7);
        cols.y = Some(fx - 6);
        cols.z = Some(fx - 5);
        cols.point = cols.point.or(Some(fx - 4));
        cols.display = cols.display.or(Some(fx - 3));
        cols.time = cols.time.or(Some(fx - 1));
        cols.group = cols.group.or_else(|| (fx >= 8).then_some(fx - 8));
    }
    cols.ready().then_some(cols)
}

fn split_line(line: &str) -> Vec<&str> {
    if line.contains('\t') {
        line.split('\t').collect()
    } else if line.contains(',') {
        line.split(',').collect()
    } else {
        line.split_whitespace().collect()
    }
}

fn likely_title(cells: &[&str]) -> Option<String> {
    let non_empty: Vec<String> = cells
        .iter()
        .map(|v| clean(v))
        .filter(|v| !v.is_empty())
        .collect();
    if non_empty.is_empty() || non_empty.len() > 3 {
        return None;
    }
    let title = non_empty.join(" ");
    if title.chars().count() > 80 {
        return None;
    }
    // Descriptive notes (which may mention "工况") must never be treated as a
    // case header, otherwise a trailing note could rename the current case.
    if [
        "备注", "说明", "注：", "注:", "注意", "以上", "合计", "总计",
    ]
    .iter()
    .any(|marker| title.starts_with(marker))
    {
        return None;
    }
    let lower = title.to_lowercase();
    (lower.contains("case")
        || lower.contains("工况")
        || lower.contains("load")
        || lower.contains("载荷"))
    .then_some(title)
}

#[tauri::command]
pub fn parse_clipboard_table(text: String) -> Result<ParseResult, String> {
    if text.trim().is_empty() {
        return Err("请先粘贴表格内容".into());
    }
    let mut rows = Vec::new();
    let mut warnings = Vec::new();
    let mut ignored_details: Vec<(usize, &'static str)> = Vec::new();
    let mut cols: Option<Columns> = None;
    let mut case_name = "Load Case 1".to_string();
    let mut carried_group = String::new();

    for (line_idx, raw_line) in text.lines().enumerate() {
        let line_no = line_idx + 1;
        if raw_line.trim().is_empty() {
            continue;
        }
        let cells = split_line(raw_line);
        if let Some(title) = likely_title(&cells) {
            case_name = title;
            // Keep the previous column layout: many spreadsheets repeat a case
            // title but not the header row, so dropping `cols` here would
            // silently ignore the following data rows.
            continue;
        }
        if let Some(detected) = header_columns(&cells) {
            cols = Some(detected);
            continue;
        }
        let Some(c) = cols else {
            ignored_details.push((line_no, "尚未识别到表头"));
            continue;
        };
        let required = [c.x, c.y, c.z, c.fx, c.fy, c.fz];
        // A data line must actually contain every required cell; otherwise a
        // short trailing/notes line (or a row split by the wrong separator)
        // would be turned into an all-zero load row.
        if required.iter().any(|index| match index {
            Some(i) => *i >= cells.len(),
            None => true,
        }) {
            ignored_details.push((line_no, "缺少必要列"));
            continue;
        }
        let get = |index: Option<usize>| index.and_then(|i| cells.get(i));
        let raw_required: Vec<String> = required
            .iter()
            .map(|index| clean(get(*index).copied().unwrap_or_default()))
            .collect();
        if raw_required.iter().all(|value| value.is_empty()) {
            ignored_details.push((line_no, "坐标与载荷列为空"));
            continue;
        }
        let Some(x) = parse_number(get(c.x)) else {
            ignored_details.push((line_no, "X 数值无法解析"));
            continue;
        };
        let Some(y) = parse_number(get(c.y)) else {
            ignored_details.push((line_no, "Y 数值无法解析"));
            continue;
        };
        let Some(z) = parse_number(get(c.z)) else {
            ignored_details.push((line_no, "Z 数值无法解析"));
            continue;
        };
        let Some(fx) = parse_number(get(c.fx)) else {
            ignored_details.push((line_no, "FX 数值无法解析"));
            continue;
        };
        let Some(fy) = parse_number(get(c.fy)) else {
            ignored_details.push((line_no, "FY 数值无法解析"));
            continue;
        };
        let Some(fz) = parse_number(get(c.fz)) else {
            ignored_details.push((line_no, "FZ 数值无法解析"));
            continue;
        };

        let group = clean(get(c.group).copied().unwrap_or_default());
        if !group.is_empty() {
            carried_group = group;
        }
        let point_name = clean(get(c.point).copied().unwrap_or_default());
        let fallback = format!("point_{}", rows.len() + 1);
        let point_name = if point_name.is_empty() {
            fallback
        } else {
            point_name
        };
        rows.push(LoadRow {
            source_line: line_no,
            case_name: case_name.clone(),
            group_name: carried_group.clone(),
            point_name,
            display_name: clean(get(c.display).copied().unwrap_or_default()),
            x,
            y,
            z,
            time: get(c.time).and_then(|v| parse_number(Some(v))),
            fx,
            fy,
            fz,
            tx: parse_number(get(c.tx)).unwrap_or(0.0),
            ty: parse_number(get(c.ty)).unwrap_or(0.0),
            tz: parse_number(get(c.tz)).unwrap_or(0.0),
        });
    }

    if rows.is_empty() {
        return Err(
            "没有识别到有效载荷行。请确认表格包含 X/Y/Z（或合并的坐标列）以及 FX/FY/FZ 表头。"
                .into(),
        );
    }
    let ignored_lines = ignored_details.len();
    let mut warning_items = Vec::new();
    if ignored_lines > 0 {
        let message = format!(
            "已忽略 {ignored_lines} 行标题、空行或无法解析的数据"
        );
        let targets = ignored_details
            .iter()
            .map(|(line_no, reason)| WarningTarget {
                kind: WarningTargetKind::SourceLine,
                label: Some(format!("第 {line_no} 行 · {reason}")),
                row_index: None,
                source_line: Some(*line_no),
                fields: Vec::new(),
            })
            .collect();
        warnings.push(message.clone());
        warning_items.push(LoadDeckWarning {
            code: "PARSE_IGNORED_LINES".into(),
            severity: WarningSeverity::Warning,
            category: "解析忽略".into(),
            message,
            targets,
        });
    }
    Ok(ParseResult {
        rows,
        warnings,
        warning_items,
        ignored_lines,
    })
}

fn finite(value: f64, field: &str, row_number: usize) -> Result<(), String> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(format!("第 {row_number} 条数据的 {field} 不是有限数值"))
    }
}

fn effective_tolerance(tolerance: f64) -> f64 {
    if tolerance.is_finite() && tolerance > 0.0 {
        tolerance
    } else {
        default_tolerance()
    }
}

fn coord_key(x: f64, y: f64, z: f64, tolerance: f64) -> String {
    if !x.is_finite() || !y.is_finite() || !z.is_finite() {
        return format!(
            "nonfinite:{}:{}:{}",
            x.is_finite(),
            y.is_finite(),
            z.is_finite()
        );
    }
    let t = effective_tolerance(tolerance);
    format!("{:.0}:{:.0}:{:.0}", x / t, y / t, z / t)
}

fn diff_coordinate_fields(first: &LoadRow, current: &LoadRow, tolerance: f64) -> Vec<String> {
    let t = effective_tolerance(tolerance);
    let mut fields = Vec::new();
    if !first.x.is_finite() || !current.x.is_finite() || (first.x - current.x).abs() > t {
        fields.push("x".into());
    }
    if !first.y.is_finite() || !current.y.is_finite() || (first.y - current.y).abs() > t {
        fields.push("y".into());
    }
    if !first.z.is_finite() || !current.z.is_finite() || (first.z - current.z).abs() > t {
        fields.push("z".into());
    }
    if fields.is_empty() {
        vec!["x".into(), "y".into(), "z".into()]
    } else {
        fields
    }
}

pub fn fmt(value: f64) -> String {
    // Nastran free-field reals: prefer plain decimal output (e.g. -4150.0)
    // over scientific notation, which some pre/post-processors reject when
    // the exponent has no explicit sign.
    if value == 0.0 || !value.is_finite() {
        return "0.0".into();
    }
    let mut text = format!("{value:.9}");
    if text.contains('.') {
        text = text.trim_end_matches('0').trim_end_matches('.').to_string();
    }
    if text.is_empty() || text == "-" {
        "0.0".into()
    } else if text.contains('.') {
        text
    } else {
        format!("{text}.0")
    }
}

fn coord_text(value: f64) -> String {
    if value == 0.0 {
        return "0".into();
    }
    let fixed = format!("{value:.9}");
    fixed
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string()
}

fn safe_name(value: &str, fallback: &str) -> String {
    let mut cleaned = String::new();
    let mut separator = false;
    for c in value.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '.') {
            if separator && !cleaned.is_empty() {
                cleaned.push('_');
            }
            cleaned.push(c);
            separator = false;
        } else if !cleaned.is_empty() {
            separator = true;
        }
    }
    if cleaned.is_empty() {
        fallback.into()
    } else {
        cleaned.chars().take(60).collect()
    }
}

fn load_factor(value: &str) -> Option<String> {
    let g_index = value.find(['g', 'G'])?;
    let prefix = &value[..g_index];
    let factor: String = prefix
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    (!factor.is_empty()).then(|| format!("{factor}g"))
}

pub fn mapped_case_name(value: &str) -> Option<String> {
    let name: String = value.chars().filter(|c| !c.is_whitespace()).collect();
    let contains_all = |keywords: &[&str]| keywords.iter().all(|keyword| name.contains(keyword));

    let mapped = if contains_all(&["左前轮上跳", "右后轮上跳"]) {
        "Front_Left_and_Rear_Right_Bump"
    } else if contains_all(&["右前轮上跳", "左后轮上跳"]) {
        "Front_Right_and_Rear_Left_Bump"
    } else if name.contains("左前单轮上跳") {
        "Front_Left_Wheel_Bump"
    } else if name.contains("右前单轮上跳") {
        "Front_Right_Wheel_Bump"
    } else if name.contains("左中轮上跳") {
        "Middle_Left_Wheel_Bump"
    } else if name.contains("右中轮上跳") {
        "Middle_Right_Wheel_Bump"
    } else if name.contains("左后轮上跳") {
        "Rear_Left_Wheel_Bump"
    } else if name.contains("右后轮上跳") {
        "Rear_Right_Wheel_Bump"
    } else if name.contains("前轮上跳") {
        "Front_Axle_Bump"
    } else if name.contains("中轮上跳") {
        "Middle_Axle_Bump"
    } else if name.contains("后轮上跳") {
        "Rear_Axle_Bump"
    } else if name.contains("静满载") || name.contains("静载工况") {
        "Static_Full_Load"
    } else if name.contains("转弯") && name.contains("左转") {
        "Left_Turn"
    } else if name.contains("转弯") && name.contains("右转") {
        "Right_Turn"
    } else if name.contains("制动") {
        return Some(match load_factor(&name) {
            Some(factor) => format!("Braking_{factor}"),
            None => "Braking".into(),
        });
    } else if name.contains("加速") {
        return Some(match load_factor(&name) {
            Some(factor) => format!("Acceleration_{factor}"),
            None => "Acceleration".into(),
        });
    } else {
        return None;
    };
    Some(mapped.into())
}

fn unique_fem_names(case_names: &[String], preferred: &BTreeMap<String, String>) -> Vec<String> {
    let mut used = HashMap::<String, usize>::new();
    case_names
        .iter()
        .enumerate()
        .map(|(index, original)| {
            let fallback = format!("loadcase_{}", index + 1);
            let mapped = mapped_case_name(original);
            let requested = preferred
                .get(original)
                .map(String::as_str)
                .or(mapped.as_deref())
                .unwrap_or(original);
            let base = safe_name(requested, &fallback);
            let count = used.entry(base.clone()).or_default();
            *count += 1;
            if *count == 1 {
                base
            } else {
                format!("{base}_{}", *count)
            }
        })
        .collect()
}

struct AnalyzedRows {
    points: Vec<PointEntry>,
    row_nodes: Vec<u64>,
    warnings: Vec<String>,
    warning_items: Vec<LoadDeckWarning>,
}

fn analyze_rows(
    rows: &[LoadRow],
    coordinate_tolerance: f64,
    stop_on_non_finite: bool,
) -> Result<AnalyzedRows, String> {
    let mut points = Vec::<PointEntry>::new();
    let mut point_by_name = HashMap::<String, usize>::new();
    let mut first_point_by_english_name = HashMap::<String, usize>::new();
    let mut first_point_by_coordinate = HashMap::<String, usize>::new();
    let mut first_row_by_point = Vec::<usize>::new();
    let mut warned_name_coordinates = HashSet::<String>::new();
    let mut row_nodes = Vec::with_capacity(rows.len());
    let mut warnings = Vec::new();
    let mut warning_items = Vec::new();

    for (index, row) in rows.iter().enumerate() {
        for (field_label, field_key, value) in [
            ("X", "x", row.x),
            ("Y", "y", row.y),
            ("Z", "z", row.z),
            ("FX", "fx", row.fx),
            ("FY", "fy", row.fy),
            ("FZ", "fz", row.fz),
            ("TX", "tx", row.tx),
            ("TY", "ty", row.ty),
            ("TZ", "tz", row.tz),
        ] {
            if stop_on_non_finite {
                finite(value, field_label, index + 1)?;
            } else if !value.is_finite() {
                let message = format!("第 {} 条数据的 {} 不是有限数值", index + 1, field_label);
                warnings.push(message.clone());
                warning_items.push(LoadDeckWarning {
                    code: "NON_FINITE_VALUE".into(),
                    severity: WarningSeverity::Error,
                    category: "数值无效".into(),
                    message,
                    targets: vec![WarningTarget {
                        kind: WarningTargetKind::DataCell,
                        label: Some(format!("第 {} 条 · {}", index + 1, field_label)),
                        row_index: Some(index),
                        source_line: None,
                        fields: vec![field_key.into()],
                    }],
                });
            }
        }
        let coordinate_key = coord_key(row.x, row.y, row.z, coordinate_tolerance);
        let fallback_english_name = format!("point_{}", index + 1);
        let raw_english_name = row.point_name.trim();
        let english_name = safe_name(raw_english_name, &fallback_english_name);
        let display_name = if row.display_name.trim().is_empty() {
            english_name.as_str()
        } else {
            row.display_name.trim()
        };
        if row.display_name.trim().is_empty() {
            let message = format!(
                "第 {} 条数据的点位“{}”缺少中文名称，暂以英文名作为归并索引；请补充中文点位名",
                index + 1,
                english_name
            );
            warnings.push(message.clone());
            warning_items.push(LoadDeckWarning {
                code: "MISSING_DISPLAY_NAME".into(),
                severity: WarningSeverity::Warning,
                category: "缺少中文名".into(),
                message,
                targets: vec![WarningTarget {
                    kind: WarningTargetKind::DataCell,
                    label: Some(format!("第 {} 条 · 中文点位名", index + 1)),
                    row_index: Some(index),
                    source_line: None,
                    fields: vec!["displayName".into()],
                }],
            });
        }
        if raw_english_name.is_empty() {
            let message = format!(
                "第 {} 条数据的点位“{}”缺少英文名称，JSON 暂使用自动名称“{}”；请补充英文点位名",
                index + 1,
                display_name,
                english_name
            );
            warnings.push(message.clone());
            warning_items.push(LoadDeckWarning {
                code: "MISSING_POINT_NAME".into(),
                severity: WarningSeverity::Warning,
                category: "缺少英文名".into(),
                message,
                targets: vec![WarningTarget {
                    kind: WarningTargetKind::DataCell,
                    label: Some(format!("第 {} 条 · 英文点位名", index + 1)),
                    row_index: Some(index),
                    source_line: None,
                    fields: vec!["pointName".into()],
                }],
            });
        } else if english_name != raw_english_name {
            let message = format!(
                "第 {} 条数据的点位“{}”的英文名“{}”包含中文、空格或不兼容字符，JSON/FEM 暂使用“{}”；请修改英文名",
                index + 1,
                display_name,
                raw_english_name,
                english_name
            );
            warnings.push(message.clone());
            warning_items.push(LoadDeckWarning {
                code: "INVALID_POINT_NAME".into(),
                severity: WarningSeverity::Warning,
                category: "英文名不规范".into(),
                message,
                targets: vec![WarningTarget {
                    kind: WarningTargetKind::DataCell,
                    label: Some(format!("第 {} 条 · 英文点位名", index + 1)),
                    row_index: Some(index),
                    source_line: None,
                    fields: vec!["pointName".into()],
                }],
            });
        }
        let point_index = if let Some(existing) = point_by_name.get(display_name).copied() {
            let existing_coordinate = coord_key(
                points[existing].x,
                points[existing].y,
                points[existing].z,
                coordinate_tolerance,
            );
            let first_row = first_row_by_point[existing];
            if points[existing].english_name != english_name {
                let message = format!(
                    "中文点位“{}”对应了不同英文名：第 {} 条数据为“{}”，第 {} 条数据为“{}”；JSON 暂保留首次英文名，请统一后重新生成",
                    display_name, first_row + 1, points[existing].english_name, index + 1, english_name
                );
                warnings.push(message.clone());
                warning_items.push(LoadDeckWarning {
                    code: "CONFLICTING_POINT_NAME".into(),
                    severity: WarningSeverity::Warning,
                    category: "英文名不一致".into(),
                    message,
                    targets: vec![
                        WarningTarget {
                            kind: WarningTargetKind::DataCell,
                            label: Some(format!("第 {} 条 ({})", first_row + 1, points[existing].english_name)),
                            row_index: Some(first_row),
                            source_line: None,
                            fields: vec!["pointName".into()],
                        },
                        WarningTarget {
                            kind: WarningTargetKind::DataCell,
                            label: Some(format!("第 {} 条 ({})", index + 1, english_name)),
                            row_index: Some(index),
                            source_line: None,
                            fields: vec!["pointName".into()],
                        },
                    ],
                });
            }
            if existing_coordinate != coordinate_key
                && warned_name_coordinates.insert(format!("{display_name}:{coordinate_key}"))
            {
                let first = &rows[first_row];
                let diff_fields = diff_coordinate_fields(first, row, coordinate_tolerance);
                let message = format!(
                    "中文点位“{}”的坐标不一致：第 {} 条数据为 ({}, {}, {})，第 {} 条数据为 ({}, {}, {})；JSON 暂保留首次坐标，请统一坐标后重新生成",
                    display_name, first_row + 1,
                    coord_text(first.x), coord_text(first.y), coord_text(first.z), index + 1,
                    coord_text(row.x), coord_text(row.y), coord_text(row.z),
                );
                warnings.push(message.clone());
                warning_items.push(LoadDeckWarning {
                    code: "INCONSISTENT_COORDINATES".into(),
                    severity: WarningSeverity::Warning,
                    category: "坐标不一致".into(),
                    message,
                    targets: vec![
                        WarningTarget {
                            kind: WarningTargetKind::DataCell,
                            label: Some(format!("第 {} 条 · 坐标", first_row + 1)),
                            row_index: Some(first_row),
                            source_line: None,
                            fields: diff_fields.clone(),
                        },
                        WarningTarget {
                            kind: WarningTargetKind::DataCell,
                            label: Some(format!("第 {} 条 · 坐标", index + 1)),
                            row_index: Some(index),
                            source_line: None,
                            fields: diff_fields,
                        },
                    ],
                });
            }
            existing
        } else {
            let node_id = NODE_ID_START + points.len() as u64;
            let name = display_name.to_string();
            let text = format!("{}_{}", english_name, node_id);
            let idx = points.len();
            points.push(PointEntry {
                node_id,
                name,
                english_name: english_name.clone(),
                x: row.x,
                y: row.y,
                z: row.z,
                text,
            });
            first_row_by_point.push(index);
            point_by_name.insert(display_name.to_string(), idx);
            let english_key = english_name.to_lowercase();
            if let Some(existing) = first_point_by_english_name.get(&english_key).copied() {
                let first_row = first_row_by_point[existing];
                let first = &rows[first_row];
                let message = format!(
                    "中文点位“{}”（第 {} 条数据）与“{}”（第 {} 条数据）使用了相同英文名“{}”；JSON 将为后者追加节点号以防覆盖，请修改英文名",
                    first.display_name, first_row + 1, display_name, index + 1, english_name
                );
                warnings.push(message.clone());
                warning_items.push(LoadDeckWarning {
                    code: "DUPLICATE_POINT_NAME".into(),
                    severity: WarningSeverity::Warning,
                    category: "英文名重复".into(),
                    message,
                    targets: vec![
                        WarningTarget {
                            kind: WarningTargetKind::DataCell,
                            label: Some(format!("第 {} 条 · {}", first_row + 1, first.display_name)),
                            row_index: Some(first_row),
                            source_line: None,
                            fields: vec!["pointName".into()],
                        },
                        WarningTarget {
                            kind: WarningTargetKind::DataCell,
                            label: Some(format!("第 {} 条 · {}", index + 1, display_name)),
                            row_index: Some(index),
                            source_line: None,
                            fields: vec!["pointName".into()],
                        },
                    ],
                });
            } else {
                first_point_by_english_name.insert(english_key, idx);
            }
            if let Some(existing) = first_point_by_coordinate.get(&coordinate_key).copied() {
                let first_row = first_row_by_point[existing];
                let message = format!(
                    "点位“{}”（第 {} 条数据）与“{}”（第 {} 条数据）使用相同坐标 ({}, {}, {})；已按名称分别生成节点和 JSON 记录，请检查左右点坐标并完成修改",
                    points[existing].name, first_row + 1, display_name, index + 1,
                    coord_text(row.x), coord_text(row.y), coord_text(row.z),
                );
                warnings.push(message.clone());
                warning_items.push(LoadDeckWarning {
                    code: "DUPLICATE_COORDINATES".into(),
                    severity: WarningSeverity::Warning,
                    category: "坐标相同".into(),
                    message,
                    targets: vec![
                        WarningTarget {
                            kind: WarningTargetKind::DataCell,
                            label: Some(format!("第 {} 条 · {}", first_row + 1, points[existing].name)),
                            row_index: Some(first_row),
                            source_line: None,
                            fields: vec!["x".into(), "y".into(), "z".into()],
                        },
                        WarningTarget {
                            kind: WarningTargetKind::DataCell,
                            label: Some(format!("第 {} 条 · {}", index + 1, display_name)),
                            row_index: Some(index),
                            source_line: None,
                            fields: vec!["x".into(), "y".into(), "z".into()],
                        },
                    ],
                });
            } else {
                first_point_by_coordinate.insert(coordinate_key, idx);
            }
            idx
        };
        row_nodes.push(points[point_index].node_id);
    }

    Ok(AnalyzedRows {
        points,
        row_nodes,
        warnings,
        warning_items,
    })
}

#[tauri::command]
pub fn validate_load_rows(request: ValidateRowsRequest) -> ValidateRowsResult {
    if request.rows.is_empty() {
        return ValidateRowsResult {
            warnings: Vec::new(),
            warning_items: Vec::new(),
        };
    }
    let analyzed = analyze_rows(&request.rows, request.coordinate_tolerance, false)
        .expect("non-stopping validation should never fail");
    ValidateRowsResult {
        warnings: analyzed.warnings,
        warning_items: analyzed.warning_items,
    }
}

#[tauri::command]
pub fn build_load_deck(request: BuildRequest) -> Result<BuildResult, String> {
    if request.rows.is_empty() {
        return Err("没有可导出的载荷数据".into());
    }
    let AnalyzedRows {
        points,
        row_nodes,
        warnings,
        warning_items,
    } = analyze_rows(&request.rows, request.coordinate_tolerance, true)?;

    let mut case_order = Vec::<String>::new();
    let mut case_rows = BTreeMap::<String, Vec<usize>>::new();
    for (index, row) in request.rows.iter().enumerate() {
        let name = if row.case_name.trim().is_empty() {
            "Load Case 1"
        } else {
            row.case_name.trim()
        };
        if !case_rows.contains_key(name) {
            case_order.push(name.to_string());
        }
        case_rows.entry(name.to_string()).or_default().push(index);
    }

    let project = safe_name(&request.project_name, "load_deck");
    let fem_case_names = unique_fem_names(&case_order, &request.case_aliases);
    let mut fem = String::new();
    fem.push_str("$ Generated by LoadDeck - incremental Nastran/OptiStruct deck\n");
    fem.push_str(&format!("$ Project: {project}\n"));
    fem.push_str("$ Node IDs start at 1001; load set IDs start at 100001.\n");
    fem.push_str(
        "$ GRID cards are intentionally omitted. Create the nodes from the companion JSON first.\n",
    );
    fem.push_str("SOL 101\nCEND\n");
    fem.push_str(&format!("TITLE = {}\n", project));
    let mut cases = Vec::new();
    for (case_index, case_name) in case_order.iter().enumerate() {
        let subcase = case_index + 1;
        let load_id = LOAD_ID_START + case_index as u64;
        let fem_name = &fem_case_names[case_index];
        let collector_name = safe_name(
            &format!("LC_{subcase:03}_{fem_name}"),
            &format!("LC_{subcase:03}"),
        );
        let load_step_name = safe_name(
            &format!("LS_{subcase:03}_{fem_name}"),
            &format!("LS_{subcase:03}"),
        );
        fem.push_str(&format!(
            "SUBCASE {subcase}\n  LABEL = {load_step_name}\n  LOAD = {load_id}\n"
        ));
        cases.push(CaseSummary {
            name: case_name.clone(),
            fem_name: fem_name.clone(),
            collector_name,
            load_step_name,
            load_id,
            row_count: case_rows[case_name].len(),
        });
    }
    fem.push_str("BEGIN BULK\n");
    fem.push_str("$ --- node references (coordinates are in the companion JSON) -----\n");
    for point in &points {
        fem.push_str(&format!(
            "$HMNAME NODES {} \"{}\"\n",
            point.node_id,
            safe_name(&point.english_name, &format!("point_{}", point.node_id))
        ));
        fem.push_str(&format!(
            "$ NODE {} -> {} ({}, {}, {})\n",
            point.node_id,
            safe_name(&point.english_name, "point"),
            fmt(point.x),
            fmt(point.y),
            fmt(point.z)
        ));
    }
    fem.push_str("$ --- load collectors / load steps --------------------------------\n");
    for (case_index, case_name) in case_order.iter().enumerate() {
        let load_id = LOAD_ID_START + case_index as u64;
        let case = &cases[case_index];
        fem.push_str(&format!(
            "$HMNAME LOADCOLS {load_id} \"{}\"\n",
            case.collector_name
        ));
        fem.push_str(&format!(
            "$HMNAME LOADSTEPS {} \"{}\"\n",
            case_index + 1,
            case.load_step_name
        ));
        for row_index in &case_rows[case_name] {
            let row = &request.rows[*row_index];
            let node = row_nodes[*row_index];
            if row.fx != 0.0 || row.fy != 0.0 || row.fz != 0.0 {
                fem.push_str(&format!(
                    "FORCE,{load_id},{node},0,1.0,{},{},{}\n",
                    fmt(row.fx),
                    fmt(row.fy),
                    fmt(row.fz)
                ));
            }
            if row.tx != 0.0 || row.ty != 0.0 || row.tz != 0.0 {
                fem.push_str(&format!(
                    "MOMENT,{load_id},{node},0,1.0,{},{},{}\n",
                    fmt(row.tx),
                    fmt(row.ty),
                    fmt(row.tz)
                ));
            }
        }
    }
    fem.push_str("ENDDATA\n");

    let json = points_to_json(&points)?;
    Ok(BuildResult {
        fem,
        json,
        points,
        cases,
        warnings,
        warning_items,
    })
}

pub fn points_to_json(points: &[PointEntry]) -> Result<String, String> {
    let mut json_map = serde_json::Map::new();
    for point in points {
        let mut json_key = point.english_name.clone();
        if json_map.contains_key(&json_key) {
            json_key = format!("{}_{}", point.english_name, point.node_id);
        }
        json_map.insert(
            json_key,
            serde_json::json!({
                "nodeId": point.node_id,
                "label": point.text,
                "x": point.x,
                "y": point.y,
                "z": point.z
            }),
        );
    }
    serde_json::to_string_pretty(&json_map).map_err(|e| e.to_string())
}

pub struct TabularFragmentOutput {
    pub points: Vec<PointEntry>,
    pub cases: Vec<CaseSummary>,
    pub warnings: Vec<String>,
}

pub fn generate_tabular_into(
    spec: &crate::core::case_spec::TabularLoadSpec,
    key_prefix: &str,
    spc_sid: Option<u64>,
    ctx: &mut crate::core::deck_ir::GenerationContext,
    frag: &mut crate::core::deck_ir::DeckFragment,
) -> Result<TabularFragmentOutput, String> {
    if spec.rows.is_empty() {
        return Err("整车工况表没有可生成的载荷行".into());
    }
    let AnalyzedRows {
        points,
        row_nodes,
        warnings,
        ..
    } = analyze_rows(&spec.rows, spec.coordinate_tolerance, true)?;

    for w in &warnings {
        ctx.warn("LC-TABULAR-001", w.clone());
    }

    let mut case_order = Vec::<String>::new();
    let mut case_rows = BTreeMap::<String, Vec<usize>>::new();
    for (index, row) in spec.rows.iter().enumerate() {
        let name = if row.case_name.trim().is_empty() {
            "Load Case 1"
        } else {
            row.case_name.trim()
        };
        if !case_rows.contains_key(name) {
            case_order.push(name.to_string());
        }
        case_rows.entry(name.to_string()).or_default().push(index);
    }

    let fem_case_names = unique_fem_names(&case_order, &spec.case_aliases);
    for point in &points {
        ctx.metadata(
            "NODES",
            point.node_id,
            safe_name(&point.english_name, &format!("point_{}", point.node_id)),
        );
    }

    let mut cases = Vec::new();
    for (case_index, case_name) in case_order.iter().enumerate() {
        let sc = ctx.allocate(
            crate::core::ids::IdKind::Subcase,
            &format!("{key_prefix}#sub#{case_index}"),
        );
        let load_id = ctx.allocate(
            crate::core::ids::IdKind::Load,
            &format!("{key_prefix}#load#{case_index}"),
        );
        let fem_name = &fem_case_names[case_index];
        let tag = format!("{:03}_{fem_name}", case_index + 1);
        let collector_name = safe_name(&format!("LC_{tag}"), &format!("LC_{:03}", case_index + 1));
        let load_step_name = safe_name(&format!("LS_{tag}"), &format!("LS_{:03}", case_index + 1));

        ctx.metadata("LOADCOLS", load_id, collector_name.clone());
        ctx.metadata("LOADSTEPS", sc, load_step_name.clone());

        for row_index in &case_rows[case_name] {
            let row = &spec.rows[*row_index];
            let node = row_nodes[*row_index];
            if row.fx != 0.0 || row.fy != 0.0 || row.fz != 0.0 {
                frag.bulk_cards.push(crate::core::cards::BulkCard::Force {
                    sid: load_id,
                    gid: node,
                    cid: 0,
                    scale: 1.0,
                    f: crate::core::cards::Vec3::new(row.fx, row.fy, row.fz),
                });
            }
            if row.tx != 0.0 || row.ty != 0.0 || row.tz != 0.0 {
                frag.bulk_cards.push(crate::core::cards::BulkCard::Moment {
                    sid: load_id,
                    gid: node,
                    cid: 0,
                    scale: 1.0,
                    m: crate::core::cards::Vec3::new(row.tx, row.ty, row.tz),
                });
            }
        }

        frag.subcases.push(crate::core::deck_ir::Subcase {
            id: sc,
            label: load_step_name.clone(),
            analysis: Some("STATICS".into()),
            spc: spc_sid,
            load: Some(load_id),
            outputs: crate::modules::static_outputs("STATIC_BASIC"),
            ..Default::default()
        });

        cases.push(CaseSummary {
            name: case_name.clone(),
            fem_name: fem_name.clone(),
            collector_name,
            load_step_name,
            load_id,
            row_count: case_rows[case_name].len(),
        });
    }

    Ok(TabularFragmentOutput {
        points,
        cases,
        warnings,
    })
}

fn safe_file_stem(value: &str) -> String {
    let name = safe_name(value, "load_deck");
    name.trim_matches('.').to_string()
}

#[tauri::command]
pub fn export_load_bundle(
    directory: String,
    base_name: String,
    fem: String,
    json: String,
) -> Result<ExportResult, String> {
    let dir = Path::new(&directory);
    if !dir.is_dir() {
        return Err("导出目录不存在".into());
    }
    let stem = safe_file_stem(&base_name);
    let fem_path: PathBuf = dir.join(format!("{stem}.fem"));
    let json_path: PathBuf = dir.join(format!("{stem}_points.json"));
    fs::write(&fem_path, fem).map_err(|e| format!("写入 FEM 失败：{e}"))?;
    fs::write(&json_path, json).map_err(|e| format!("写入 JSON 失败：{e}"))?;
    Ok(ExportResult {
        fem_path: fem_path.to_string_lossy().into_owned(),
        json_path: json_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn export_output_file(path: String, content: String) -> Result<String, String> {
    let target = PathBuf::from(path);
    let Some(parent) = target.parent() else {
        return Err("保存路径无效".into());
    };
    if !parent.is_dir() {
        return Err("保存目录不存在".into());
    }
    fs::write(&target, content).map_err(|e| format!("写入文件失败：{e}"))?;
    Ok(target.to_string_lossy().into_owned())
}
