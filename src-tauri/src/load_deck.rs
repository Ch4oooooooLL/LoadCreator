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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseResult {
    pub rows: Vec<LoadRow>,
    pub warnings: Vec<String>,
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
    cells.iter().position(|cell| {
        let value = norm(cell);
        aliases.iter().any(|alias| value == *alias)
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
        group: find_col(cells, &["group", "system", "分组", "系统"]),
        x: find_col(cells, &["x", "coordx", "x坐标", "坐标x"]),
        y: find_col(cells, &["y", "coordy", "y坐标", "坐标y"]),
        z: find_col(cells, &["z", "coordz", "z坐标", "坐标z"]),
        point: find_col(cells, &["name", "point", "pointname", "englishname", "英文名", "英文名称"]),
        display: find_col(cells, &["displayname", "description", "中文名", "点位名称", "落点名称"]),
        time: find_col(cells, &["time", "时间", "时刻"]),
        fx: Some(fx),
        fy,
        fz,
        tx: find_col(cells, &["tx", "mx", "momentx", "扭矩x"]),
        ty: find_col(cells, &["ty", "my", "momenty", "扭矩y"]),
        tz: find_col(cells, &["tz", "mz", "momentz", "扭矩z"]),
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
    let non_empty: Vec<String> = cells.iter().map(|v| clean(v)).filter(|v| !v.is_empty()).collect();
    if non_empty.is_empty() || non_empty.len() > 3 {
        return None;
    }
    let title = non_empty.join(" ");
    let lower = title.to_lowercase();
    (lower.contains("case") || lower.contains("工况") || lower.contains("load") || lower.contains("载荷"))
        .then_some(title)
}

#[tauri::command]
pub fn parse_clipboard_table(text: String) -> Result<ParseResult, String> {
    if text.trim().is_empty() {
        return Err("请先粘贴表格内容".into());
    }
    let mut rows = Vec::new();
    let mut warnings = Vec::new();
    let mut ignored_lines = 0;
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
            cols = None;
            continue;
        }
        if let Some(detected) = header_columns(&cells) {
            cols = Some(detected);
            continue;
        }
        let Some(c) = cols else {
            ignored_lines += 1;
            continue;
        };
        let get = |index: Option<usize>| index.and_then(|i| cells.get(i));
        let Some(x) = parse_number(get(c.x)) else { ignored_lines += 1; continue };
        let Some(y) = parse_number(get(c.y)) else { ignored_lines += 1; continue };
        let Some(z) = parse_number(get(c.z)) else { ignored_lines += 1; continue };
        let Some(fx) = parse_number(get(c.fx)) else { ignored_lines += 1; continue };
        let Some(fy) = parse_number(get(c.fy)) else { ignored_lines += 1; continue };
        let Some(fz) = parse_number(get(c.fz)) else { ignored_lines += 1; continue };

        let group = clean(get(c.group).copied().unwrap_or_default());
        if !group.is_empty() {
            carried_group = group;
        }
        let point_name = clean(get(c.point).copied().unwrap_or_default());
        let fallback = format!("point_{}", rows.len() + 1);
        let point_name = if point_name.is_empty() { fallback } else { point_name };
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
        return Err("没有识别到有效载荷行。请确认表格包含 X/Y/Z（或合并的坐标列）以及 FX/FY/FZ 表头。".into());
    }
    if ignored_lines > 0 {
        warnings.push(format!("已忽略 {ignored_lines} 行标题、空行或无法解析的数据"));
    }
    Ok(ParseResult { rows, warnings, ignored_lines })
}

fn finite(value: f64, field: &str, row_number: usize) -> Result<(), String> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(format!("第 {row_number} 条数据的 {field} 不是有限数值"))
    }
}

fn coord_key(x: f64, y: f64, z: f64, tolerance: f64) -> String {
    let t = if tolerance.is_finite() && tolerance > 0.0 { tolerance } else { default_tolerance() };
    format!("{:.0}:{:.0}:{:.0}", x / t, y / t, z / t)
}

fn fmt(value: f64) -> String {
    if value == 0.0 { "0.0".into() } else { format!("{value:.9e}") }
}

fn coord_text(value: f64) -> String {
    if value == 0.0 {
        return "0".into();
    }
    let fixed = format!("{value:.9}");
    fixed.trim_end_matches('0').trim_end_matches('.').to_string()
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
    if cleaned.is_empty() { fallback.into() } else { cleaned.chars().take(60).collect() }
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

fn mapped_case_name(value: &str) -> Option<String> {
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
                .or_else(|| mapped.as_deref())
                .unwrap_or(original);
            let base = safe_name(requested, &fallback);
            let count = used.entry(base.clone()).or_default();
            *count += 1;
            if *count == 1 { base } else { format!("{base}_{}", *count) }
        })
        .collect()
}

#[tauri::command]
pub fn build_load_deck(request: BuildRequest) -> Result<BuildResult, String> {
    if request.rows.is_empty() {
        return Err("没有可导出的载荷数据".into());
    }
    let mut points = Vec::<PointEntry>::new();
    let mut point_by_name = HashMap::<String, usize>::new();
    let mut first_point_by_english_name = HashMap::<String, usize>::new();
    let mut first_point_by_coordinate = HashMap::<String, usize>::new();
    let mut first_row_by_point = Vec::<usize>::new();
    let mut warned_name_coordinates = HashSet::<String>::new();
    let mut row_nodes = Vec::with_capacity(request.rows.len());
    let mut warnings = Vec::new();

    for (index, row) in request.rows.iter().enumerate() {
        for (field, value) in [("X", row.x), ("Y", row.y), ("Z", row.z), ("FX", row.fx), ("FY", row.fy), ("FZ", row.fz), ("TX", row.tx), ("TY", row.ty), ("TZ", row.tz)] {
            finite(value, field, index + 1)?;
        }
        let coordinate_key = coord_key(row.x, row.y, row.z, request.coordinate_tolerance);
        let fallback_english_name = format!("point_{}", index + 1);
        let raw_english_name = row.point_name.trim();
        let english_name = safe_name(raw_english_name, &fallback_english_name);
        let display_name = if row.display_name.trim().is_empty() { english_name.as_str() } else { row.display_name.trim() };
        if row.display_name.trim().is_empty() {
            warnings.push(format!("第 {} 条数据的点位“{}”缺少中文名称，暂以英文名作为归并索引；请补充中文点位名", index + 1, english_name));
        }
        if raw_english_name.is_empty() {
            warnings.push(format!("第 {} 条数据的点位“{}”缺少英文名称，JSON 暂使用自动名称“{}”；请补充英文点位名", index + 1, display_name, english_name));
        } else if english_name != raw_english_name {
            warnings.push(format!("第 {} 条数据的点位“{}”的英文名“{}”包含中文、空格或不兼容字符，JSON/FEM 暂使用“{}”；请修改英文名", index + 1, display_name, raw_english_name, english_name));
        }
        let point_index = if let Some(existing) = point_by_name.get(display_name).copied() {
            let existing_coordinate = coord_key(points[existing].x, points[existing].y, points[existing].z, request.coordinate_tolerance);
            if points[existing].english_name != english_name {
                warnings.push(format!(
                    "中文点位“{}”对应了不同英文名：第 {} 条数据为“{}”，第 {} 条数据为“{}”；JSON 暂保留首次英文名，请统一后重新生成",
                    display_name, first_row_by_point[existing] + 1, points[existing].english_name, index + 1, english_name
                ));
            }
            if existing_coordinate != coordinate_key && warned_name_coordinates.insert(format!("{display_name}:{coordinate_key}")) {
                let first = &request.rows[first_row_by_point[existing]];
                warnings.push(format!(
                    "中文点位“{}”的坐标不一致：第 {} 条数据为 ({}, {}, {})，第 {} 条数据为 ({}, {}, {})；JSON 暂保留首次坐标，请统一坐标后重新生成",
                    display_name, first_row_by_point[existing] + 1,
                    coord_text(first.x), coord_text(first.y), coord_text(first.z), index + 1,
                    coord_text(row.x), coord_text(row.y), coord_text(row.z),
                ));
            }
            existing
        } else {
            let node_id = NODE_ID_START + points.len() as u64;
            let name = display_name.to_string();
            let text = format!("{}_{}", english_name, node_id);
            let idx = points.len();
            points.push(PointEntry { node_id, name, english_name: english_name.clone(), x: row.x, y: row.y, z: row.z, text });
            first_row_by_point.push(index);
            point_by_name.insert(display_name.to_string(), idx);
            let english_key = english_name.to_lowercase();
            if let Some(existing) = first_point_by_english_name.get(&english_key).copied() {
                let first = &request.rows[first_row_by_point[existing]];
                warnings.push(format!(
                    "中文点位“{}”（第 {} 条数据）与“{}”（第 {} 条数据）使用了相同英文名“{}”；JSON 将为后者追加节点号以防覆盖，请修改英文名",
                    first.display_name, first_row_by_point[existing] + 1, display_name, index + 1, english_name
                ));
            } else {
                first_point_by_english_name.insert(english_key, idx);
            }
            if let Some(existing) = first_point_by_coordinate.get(&coordinate_key).copied() {
                warnings.push(format!(
                    "点位“{}”（第 {} 条数据）与“{}”（第 {} 条数据）使用相同坐标 ({}, {}, {})；已按名称分别生成节点和 JSON 记录，请检查左右点坐标并完成修改",
                    points[existing].name, first_row_by_point[existing] + 1, display_name, index + 1,
                    coord_text(row.x), coord_text(row.y), coord_text(row.z),
                ));
            } else {
                first_point_by_coordinate.insert(coordinate_key, idx);
            }
            idx
        };
        row_nodes.push(points[point_index].node_id);
    }

    let mut case_order = Vec::<String>::new();
    let mut case_rows = BTreeMap::<String, Vec<usize>>::new();
    for (index, row) in request.rows.iter().enumerate() {
        let name = if row.case_name.trim().is_empty() { "Load Case 1" } else { row.case_name.trim() };
        if !case_rows.contains_key(name) { case_order.push(name.to_string()); }
        case_rows.entry(name.to_string()).or_default().push(index);
    }

    let project = safe_name(&request.project_name, "load_deck");
    let fem_case_names = unique_fem_names(&case_order, &request.case_aliases);
    let mut fem = String::new();
    fem.push_str("$ Generated by LoadDeck - incremental Nastran/OptiStruct deck\n");
    fem.push_str(&format!("$ Project: {project}\n"));
    fem.push_str("$ Node IDs start at 1001; load set IDs start at 100001.\n");
    fem.push_str("$ GRID cards are intentionally omitted. Create the nodes from the companion JSON first.\n");
    fem.push_str("SOL 101\nCEND\n");
    fem.push_str(&format!("TITLE = {}\n", project));
    let mut cases = Vec::new();
    for (case_index, case_name) in case_order.iter().enumerate() {
        let subcase = case_index + 1;
        let load_id = LOAD_ID_START + case_index as u64;
        let fem_name = &fem_case_names[case_index];
        let collector_name = safe_name(&format!("LC_{subcase:03}_{fem_name}"), &format!("LC_{subcase:03}"));
        let load_step_name = safe_name(&format!("LS_{subcase:03}_{fem_name}"), &format!("LS_{subcase:03}"));
        fem.push_str(&format!("SUBCASE {subcase}\n  LABEL = {load_step_name}\n  LOAD = {load_id}\n"));
        cases.push(CaseSummary { name: case_name.clone(), fem_name: fem_name.clone(), collector_name, load_step_name, load_id, row_count: case_rows[case_name].len() });
    }
    fem.push_str("BEGIN BULK\n");
    fem.push_str("$ --- node references (coordinates are in the companion JSON) -----\n");
    for point in &points {
        fem.push_str(&format!("$HMNAME NODES {} \"{}\"\n", point.node_id, safe_name(&point.english_name, &format!("point_{}", point.node_id))));
        fem.push_str(&format!("$ NODE {} -> {} ({}, {}, {})\n", point.node_id, safe_name(&point.english_name, "point"), fmt(point.x), fmt(point.y), fmt(point.z)));
    }
    fem.push_str("$ --- load collectors / load steps --------------------------------\n");
    for (case_index, case_name) in case_order.iter().enumerate() {
        let load_id = LOAD_ID_START + case_index as u64;
        let case = &cases[case_index];
        fem.push_str(&format!("$HMNAME LOADCOLS {load_id} \"{}\"\n", case.collector_name));
        fem.push_str(&format!("$HMNAME LOADSTEPS {} \"{}\"\n", case_index + 1, case.load_step_name));
        for row_index in &case_rows[case_name] {
            let row = &request.rows[*row_index];
            let node = row_nodes[*row_index];
            if row.fx != 0.0 || row.fy != 0.0 || row.fz != 0.0 {
                fem.push_str(&format!("FORCE,{load_id},{node},0,1.0,{},{},{}\n", fmt(row.fx), fmt(row.fy), fmt(row.fz)));
            }
            if row.tx != 0.0 || row.ty != 0.0 || row.tz != 0.0 {
                fem.push_str(&format!("MOMENT,{load_id},{node},0,1.0,{},{},{}\n", fmt(row.tx), fmt(row.ty), fmt(row.tz)));
            }
        }
    }
    fem.push_str("ENDDATA\n");

    let mut json_map = serde_json::Map::new();
    for point in &points {
        let mut json_key = point.english_name.clone();
        if json_map.contains_key(&json_key) {
            json_key = format!("{}_{}", point.english_name, point.node_id);
        }
        json_map.insert(json_key, serde_json::json!({
            "nodeId": point.node_id,
            "label": point.text,
            "x": point.x,
            "y": point.y,
            "z": point.z
        }));
    }
    let json = serde_json::to_string_pretty(&json_map).map_err(|e| e.to_string())?;
    Ok(BuildResult { fem, json, points, cases, warnings })
}

fn safe_file_stem(value: &str) -> String {
    let name = safe_name(value, "load_deck");
    name.trim_matches('.').to_string()
}

#[tauri::command]
pub fn export_load_bundle(directory: String, base_name: String, fem: String, json: String) -> Result<ExportResult, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_explicit_headers_and_builds_nodes_by_point_name() {
        let text = "case1 braking\nGroup\tX\tY\tZ\tEnglish Name\t中文名\tTime\tFX\tFY\tFZ\tTX\tTY\tTZ\nfront\t1\t2\t3\tfront_left\t左侧\t7\t10\t0\t-20\t0\t5\t0\n\t1\t2\t3\talias\t重复\t7\t0\t1\t0\t0\t0\t0";
        let parsed = parse_clipboard_table(text.into()).unwrap();
        assert_eq!(parsed.rows.len(), 2);
        let built = build_load_deck(BuildRequest { project_name: "demo".into(), rows: parsed.rows, case_aliases: BTreeMap::new(), coordinate_tolerance: 1e-6 }).unwrap();
        assert_eq!(built.points.len(), 2);
        assert_eq!(built.points[0].name, "左侧");
        assert_eq!(built.points[0].english_name, "front_left");
        assert!(!built.fem.contains("GRID,"));
        assert!(built.fem.contains("$ NODE 1001"));
        assert!(built.fem.contains("FORCE,100001,1001"));
        assert!(built.fem.contains("MOMENT,100001,1001"));
        assert!(built.json.contains("front_left_1001"));
        assert!(built.json.contains("\"alias\""));
        assert!(built.json.find("\"front_left\"").unwrap() < built.json.find("\"alias\"").unwrap());
    }

    #[test]
    fn parses_merged_coordinate_layout() {
        let text = "case13 steering\n分组\t落点坐标\t\t\t\t落点名称\t序号\t时间\tFX\tFY\tFZ\tTX\tTY\tTZ\nfront\t1550\t0\t-210\tfrontsusp_a\t前悬\t1\t7\t-3.85e2\t-4.15e3\t3.56e4\t0\t0\t0";
        let parsed = parse_clipboard_table(text.into()).unwrap();
        assert_eq!(parsed.rows[0].point_name, "frontsusp_a");
        assert_eq!(parsed.rows[0].x, 1550.0);
        assert_eq!(parsed.rows[0].fz, 35600.0);
    }

    #[test]
    fn explains_when_different_points_share_coordinates() {
        let rows = vec![
            LoadRow { source_line: 16, case_name: "case1".into(), group_name: "rear".into(), point_name: "rear_left".into(), display_name: "后桥缓冲块左".into(), x: 5061.0, y: -518.0, z: 137.0, time: None, fx: 1.0, fy: 0.0, fz: 0.0, tx: 0.0, ty: 0.0, tz: 0.0 },
            LoadRow { source_line: 17, case_name: "case1".into(), group_name: "rear".into(), point_name: "rear_right".into(), display_name: "后桥缓冲块右".into(), x: 5061.0, y: -518.0, z: 137.0, time: None, fx: 1.0, fy: 0.0, fz: 0.0, tx: 0.0, ty: 0.0, tz: 0.0 },
        ];
        let built = build_load_deck(BuildRequest { project_name: "demo".into(), rows, case_aliases: BTreeMap::new(), coordinate_tolerance: 1e-6 }).unwrap();
        assert_eq!(built.points.len(), 2);
        assert!(built.warnings[0].contains("第 1 条数据"));
        assert!(built.warnings[0].contains("第 2 条数据"));
        assert!(!built.warnings[0].contains("原表"));
        assert!(built.warnings[0].contains("分别生成节点和 JSON 记录"));
    }

    #[test]
    fn keeps_chinese_case_names_in_ui_but_writes_ascii_fem_aliases() {
        let row = LoadRow { source_line: 3, case_name: "case1 静载工况（前轮1g）".into(), group_name: String::new(), point_name: "point_a".into(), display_name: String::new(), x: 1.0, y: 2.0, z: 3.0, time: None, fx: 1.0, fy: 0.0, fz: 0.0, tx: 0.0, ty: 0.0, tz: 0.0 };
        let aliases = BTreeMap::from([("case1 静载工况（前轮1g）".into(), "static_front_1g".into())]);
        let built = build_load_deck(BuildRequest { project_name: "中文项目".into(), rows: vec![row], case_aliases: aliases, coordinate_tolerance: 1e-6 }).unwrap();
        assert_eq!(built.cases[0].name, "case1 静载工况（前轮1g）");
        assert_eq!(built.cases[0].fem_name, "static_front_1g");
        assert!(built.fem.is_ascii());
        assert!(built.fem.contains("LABEL = LS_001_static_front_1g"));
        assert!(built.fem.contains("\"LC_001_static_front_1g\""));
    }

    #[test]
    fn groups_by_chinese_name_and_warns_about_conflicting_english_names() {
        let rows = vec![
            LoadRow { source_line: 3, case_name: "case1".into(), group_name: String::new(), point_name: "point_a".into(), display_name: "连接点".into(), x: 1.0, y: 2.0, z: 3.0, time: None, fx: 1.0, fy: 0.0, fz: 0.0, tx: 0.0, ty: 0.0, tz: 0.0 },
            LoadRow { source_line: 6, case_name: "case2".into(), group_name: String::new(), point_name: "point_b".into(), display_name: "连接点".into(), x: 1.0, y: 2.0, z: 3.0, time: None, fx: 1.0, fy: 0.0, fz: 0.0, tx: 0.0, ty: 0.0, tz: 0.0 },
        ];
        let built = build_load_deck(BuildRequest { project_name: "demo".into(), rows, case_aliases: BTreeMap::new(), coordinate_tolerance: 1e-6 }).unwrap();
        assert_eq!(built.points.len(), 1);
        assert_eq!(built.points[0].name, "连接点");
        assert_eq!(built.points[0].english_name, "point_a");
        assert!(built.warnings.iter().any(|warning| warning.contains("对应了不同英文名")));
        assert!(built.json.contains("\"point_a\""));
    }

    #[test]
    fn preserves_json_entries_when_chinese_points_share_an_english_name() {
        let rows = vec![
            LoadRow { source_line: 3, case_name: "case1".into(), group_name: String::new(), point_name: "shared".into(), display_name: "左点".into(), x: 1.0, y: -2.0, z: 3.0, time: None, fx: 1.0, fy: 0.0, fz: 0.0, tx: 0.0, ty: 0.0, tz: 0.0 },
            LoadRow { source_line: 4, case_name: "case1".into(), group_name: String::new(), point_name: "shared".into(), display_name: "右点".into(), x: 1.0, y: 2.0, z: 3.0, time: None, fx: 1.0, fy: 0.0, fz: 0.0, tx: 0.0, ty: 0.0, tz: 0.0 },
        ];
        let built = build_load_deck(BuildRequest { project_name: "demo".into(), rows, case_aliases: BTreeMap::new(), coordinate_tolerance: 1e-6 }).unwrap();
        assert_eq!(built.points.len(), 2);
        assert!(built.warnings.iter().any(|warning| warning.contains("使用了相同英文名")));
        assert!(built.json.contains("\"shared\""));
        assert!(built.json.contains("\"shared_1002\""));
    }

    #[test]
    fn maps_the_supported_base_case_keywords() {
        let cases = [
            ("case1 静满载", "Static_Full_Load"),
            ("case2 前轮上跳工况", "Front_Axle_Bump"),
            ("case3 中轮上跳工况", "Middle_Axle_Bump"),
            ("case4 后轮上跳工况", "Rear_Axle_Bump"),
            ("case5 左前单轮上跳", "Front_Left_Wheel_Bump"),
            ("case6 右前单轮上跳", "Front_Right_Wheel_Bump"),
            ("case7 左中轮上跳", "Middle_Left_Wheel_Bump"),
            ("case8 右中轮上跳", "Middle_Right_Wheel_Bump"),
            ("case9 左后轮上跳", "Rear_Left_Wheel_Bump"),
            ("case10 右后轮上跳", "Rear_Right_Wheel_Bump"),
            ("case11 左前轮上跳&右后轮上跳", "Front_Left_and_Rear_Right_Bump"),
            ("case12 右前轮上跳&左后轮上跳", "Front_Right_and_Rear_Left_Bump"),
            ("case13 转弯（左转）", "Left_Turn"),
            ("case14 制动 整车质心减速度0.15g", "Braking_0.15g"),
            ("case15 制动 整车质心减速度0.2g", "Braking_0.2g"),
            ("case16 加速 整车质心加速度0.15g", "Acceleration_0.15g"),
        ];
        for (source, expected) in cases {
            assert_eq!(mapped_case_name(source).as_deref(), Some(expected), "{source}");
        }
    }
}
