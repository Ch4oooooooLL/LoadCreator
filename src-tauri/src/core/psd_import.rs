//! PSD spectrum import from CSV / TXT / XLSX.
//!
//! The importer is intentionally conservative: it never guesses physical units
//! and never invents points. It extracts the frequency / PSD series using a
//! small set of documented recognition rules, then leaves the numbers on screen
//! for a human to confirm inside the PSD workbench.
//!
//! Recognition rules (in order):
//!   1. Comment lines starting with '#' or '//' and blank lines are ignored.
//!   2. If a row contains a frequency header and a PSD header, that row is the
//!      header; the two matching columns are used for every following row.
//!      Chinese and English aliases are both accepted (频率/频率Hz/f/Freq...
//!      and PSD/功率谱密度/谱值/g^2/Hz...).
//!   3. With no header the first two numeric columns are used. A leading
//!      sequence column (1,2,3,...) is detected and skipped automatically.
//!   4. Numbers embedded in unit-bearing cells are read from the leading
//!      numeric token (e.g. 10 Hz -> 10, 0.003 g^2/Hz -> 0.003).
//!   5. Anything that still does not yield a frequency/PSD pair is counted as
//!      ignored and reported as a warning.

use serde::Serialize;

use crate::core::case_spec::PsdPoint;

/// Result of reading and parsing one spectrum file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSpectrum {
    pub points: Vec<PsdPoint>,
    pub warnings: Vec<String>,
    pub ignored_lines: usize,
    /// "csv" | "txt" | "xlsx" | "ods"
    pub source_kind: String,
    /// "comma" | "tab" | "semicolon" | "whitespace" (text files only).
    pub delimiter: Option<String>,
    /// Raw header cells joined with " | ", when a header row was recognised.
    pub header: Option<String>,
    /// Worksheet name for spreadsheet inputs.
    pub sheet_name: Option<String>,
    /// Interpolation mode guessed from free-text hints in the file, if any.
    pub interpolation_guess: Option<String>,
}

/// Standard sample spectrum reused by the template writer and the UI hint.
pub const TEMPLATE_POINTS: &[(f64, f64)] = &[
    (10.0, 0.003),
    (20.0, 0.01),
    (50.0, 0.02),
    (100.0, 0.006),
    (200.0, 0.003),
];

/// Decode a byte buffer that may be UTF-8, UTF-16 (BOM) or GB18030/GBK.
pub fn decode_bytes(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        if let Ok(s) = std::str::from_utf8(&bytes[3..]) {
            return s.to_string();
        }
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let (cow, _, _) = encoding_rs::UTF_16LE.decode(bytes);
        return cow.trim_start_matches('\u{feff}').to_string();
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let (cow, _, _) = encoding_rs::UTF_16BE.decode(bytes);
        return cow.trim_start_matches('\u{feff}').to_string();
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.trim_start_matches('\u{feff}').to_string();
    }
    // Chinese Windows exports (CSV/TXT) are frequently GBK; GB18030 is a
    // superset and decodes them without data loss.
    let (cow, _, _) = encoding_rs::GB18030.decode(bytes);
    cow.trim_start_matches('\u{feff}').to_string()
}

/// Parse a plain-text spectrum table.
pub fn parse_spectrum_text(text: &str) -> ImportedSpectrum {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.lines().collect();
    let delimiter = detect_delimiter(&lines);
    let interpolation_guess = guess_interpolation(text);

    let mut grid: Vec<Vec<String>> = Vec::new();
    for line in &lines {
        let trimmed = line.trim().trim_start_matches('\u{feff}').trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('#') || trimmed.starts_with("//") {
            continue;
        }
        let mut fields: Vec<String> = split_fields(trimmed, delimiter)
            .into_iter()
            .map(|s| s.trim().to_string())
            .collect();
        while fields.last().map(|s| s.is_empty()).unwrap_or(false) {
            fields.pop();
        }
        if fields.is_empty() {
            continue;
        }
        grid.push(fields);
    }

    let mut outcome = parse_grid(&grid);
    outcome.interpolation_guess = interpolation_guess;
    ImportedSpectrum {
        points: outcome.points,
        warnings: outcome.warnings,
        ignored_lines: outcome.ignored_lines,
        source_kind: "txt".into(),
        delimiter: Some(delimiter_name(delimiter)),
        header: outcome.header,
        sheet_name: None,
        interpolation_guess: outcome.interpolation_guess,
    }
}

/// Parse a spreadsheet (.xlsx/.xls/.xlsb/.ods) from a filesystem path.
pub fn parse_spreadsheet_path(path: &std::path::Path) -> Result<ImportedSpectrum, String> {
    use calamine::{open_workbook_auto, Reader};

    let mut workbook = open_workbook_auto(path).map_err(|e| format!("无法打开表格文件：{e}"))?;
    let sheet_names = workbook.sheet_names().to_vec();
    let mut best: Option<ImportedSpectrum> = None;
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
            let mut cells: Vec<String> = Vec::with_capacity(row.len());
            for cell in row {
                cells.push(data_to_string(cell));
            }
            if cells.iter().all(|c| c.trim().is_empty()) {
                continue;
            }
            grid.push(cells);
        }
        if grid.is_empty() {
            continue;
        }
        let outcome = parse_grid(&grid);
        if outcome.points.is_empty() {
            errors.push(format!("工作表“{name}”未识别到谱数据"));
            continue;
        }
        let candidate = ImportedSpectrum {
            points: outcome.points,
            warnings: outcome.warnings,
            ignored_lines: outcome.ignored_lines,
            source_kind: "xlsx".into(),
            delimiter: None,
            header: outcome.header,
            sheet_name: Some(name),
            interpolation_guess: None,
        };
        let better = match &best {
            Some(current) => candidate.points.len() > current.points.len(),
            None => true,
        };
        if better {
            best = Some(candidate);
        }
    }

    best.ok_or_else(|| {
        if errors.is_empty() {
            "工作簿中没有可读取的工作表".to_string()
        } else {
            format!("未在任何工作表中识别到 PSD 谱数据（{}）", errors.join("；"))
        }
    })
}

/// Render the standard CSV template (UTF-8 with BOM so Excel shows Chinese).
pub fn template_csv() -> String {
    let mut s = String::new();
    s.push('\u{feff}');
    s.push_str("# PSD 随机振动输入谱 · 标准模板（LoadCreator）\n");
    s.push_str("# 说明：在下面两列填入数据即可；以 # 开头的说明行会被自动忽略，可保留。\n");
    s.push_str("# 频率必须为正且严格递增；对数插值(LOG-LOG)下 PSD 必须大于 0。\n");
    s.push_str("# 可在任意位置写一行“插值: LOG-LOG”或“插值: LINEAR-LINEAR”指定插值方式。\n");
    s.push_str("频率Hz,PSD(g^2/Hz)\n");
    for (f, p) in TEMPLATE_POINTS {
        s.push_str(&format!("{f},{p}\n"));
    }
    s
}

/// Render the standard XLSX template as bytes.
pub fn template_xlsx_bytes() -> Result<Vec<u8>, String> {
    use rust_xlsxwriter::Workbook;

    let mut workbook = Workbook::new();
    {
        let sheet = workbook.add_worksheet();
        sheet
            .set_name("PSD谱")
            .map_err(|e| format!("创建工作表失败：{e}"))?;
        sheet
            .write_string(0, 0, "频率Hz")
            .map_err(|e| e.to_string())?;
        sheet
            .write_string(0, 1, "PSD(g^2/Hz)")
            .map_err(|e| e.to_string())?;
        for (i, (f, p)) in TEMPLATE_POINTS.iter().enumerate() {
            sheet
                .write_number((i + 1) as u32, 0, *f)
                .map_err(|e| e.to_string())?;
            sheet
                .write_number((i + 1) as u32, 1, *p)
                .map_err(|e| e.to_string())?;
        }
    }
    {
        let notes = workbook.add_worksheet();
        notes
            .set_name("填写说明")
            .map_err(|e| format!("创建说明页失败：{e}"))?;
        let lines = [
            "PSD 随机振动输入谱 · 填写说明",
            "1. 在“PSD谱”工作表中只填写“频率Hz”和“PSD(g^2/Hz)”两列。",
            "2. 频率必须为正且严格递增；对数插值(LOG-LOG)下 PSD 必须大于 0。",
            "3. 单位请与实际谱一致（基座加速度通常为 g^2/Hz）。",
            "4. 保留表头行，测试完成后可直接被 LoadCreator 导入。",
            "5. 如需声明插值方式，可在任意单元格写入“插值: LOG-LOG”或“插值: LINEAR-LINEAR”。",
        ];
        for (r, text) in lines.iter().enumerate() {
            notes
                .write_string(r as u32, 0, *text)
                .map_err(|e| e.to_string())?;
        }
    }
    workbook
        .save_to_buffer()
        .map_err(|e| format!("生成 Excel 模板失败：{e}"))
}

// ---------------------------------------------------------------------------
// Internal parsing helpers
// ---------------------------------------------------------------------------

struct GridOutcome {
    points: Vec<PsdPoint>,
    warnings: Vec<String>,
    ignored_lines: usize,
    header: Option<String>,
    interpolation_guess: Option<String>,
}

fn parse_grid(grid: &[Vec<String>]) -> GridOutcome {
    let mut warnings: Vec<String> = Vec::new();
    let mut ignored = 0usize;

    // 1) locate a header row (frequency header + PSD header on the same row)
    let mut header_row: Option<usize> = None;
    let mut freq_col = 0usize;
    let mut psd_col = 0usize;
    for (r, row) in grid.iter().enumerate() {
        let mut f: Option<usize> = None;
        let mut p: Option<usize> = None;
        for (c, cell) in row.iter().enumerate() {
            if f.is_none() && is_freq_header(cell) {
                f = Some(c);
                continue;
            }
            if p.is_none() && is_psd_header(cell) {
                p = Some(c);
            }
        }
        if let (Some(fc), Some(pc)) = (f, p) {
            if fc != pc {
                header_row = Some(r);
                freq_col = fc;
                psd_col = pc;
                break;
            }
        }
    }

    let mut points: Vec<PsdPoint> = Vec::new();
    let mut header_desc: Option<String> = None;

    if let Some(h) = header_row {
        let row = &grid[h];
        let cells: Vec<String> = row
            .iter()
            .filter(|c| !c.trim().is_empty())
            .map(|c| c.trim().to_string())
            .collect();
        if !cells.is_empty() {
            header_desc = Some(cells.join(" | "));
        }
        for (r, row) in grid.iter().enumerate().skip(h + 1) {
            // Skip a repeated header block.
            if row.iter().any(|c| is_freq_header(c)) && row.iter().any(|c| is_psd_header(c)) {
                continue;
            }
            let fcell = row.get(freq_col).map(String::as_str).unwrap_or("");
            let pcell = row.get(psd_col).map(String::as_str).unwrap_or("");
            if fcell.trim().is_empty() && pcell.trim().is_empty() {
                continue;
            }
            match (parse_number_cell(fcell), parse_number_cell(pcell)) {
                (Some(f), Some(p)) => points.push(PsdPoint {
                    frequency_hz: f,
                    psd: p,
                }),
                _ => {
                    ignored += 1;
                    if warnings.len() < 20 {
                        warnings.push(format!("第 {} 行无法解析频率/PSD，已跳过", r + 1));
                    }
                }
            }
        }
    } else {
        // 2) headerless numeric heuristic
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
            return GridOutcome {
                points,
                warnings: vec![
                    "未识别到“频率- PSD”数据行。请确认文件包含两列数值，或保留标准表头（频率Hz / PSD）。"
                        .into(),
                ],
                ignored_lines: 0,
                header: None,
                interpolation_guess: None,
            };
        }

        let has_index = detect_index_column(&candidates);
        if has_index {
            warnings.push("未找到表头，已自动忽略首列递增序号。".into());
        } else {
            warnings.push(format!(
                "未找到表头，按每行前两列数值识别为“频率、PSD”，共 {} 行候选。",
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
                Some((f, p)) => points.push(PsdPoint {
                    frequency_hz: f,
                    psd: p,
                }),
                None => {
                    ignored += 1;
                    if warnings.len() < 20 {
                        warnings.push(format!("第 {} 行列数不足，已跳过", r + 1));
                    }
                }
            }
        }

        let candidate_rows: std::collections::HashSet<usize> =
            candidates.iter().map(|(r, _)| *r).collect();
        for (r, row) in grid.iter().enumerate() {
            if candidate_rows.contains(&r) {
                continue;
            }
            if row.iter().any(|c| !c.trim().is_empty()) {
                ignored += 1;
            }
        }
    }

    // 3) monotonicity sanity warning (does not drop points)
    let mut prev: Option<f64> = None;
    for (i, p) in points.iter().enumerate() {
        if let Some(pv) = prev {
            if !(p.frequency_hz > pv) && warnings.len() < 40 {
                warnings.push(format!(
                    "第 {} 个频点频率 {} Hz 未严格递增（前一个 {} Hz）",
                    i + 1,
                    p.frequency_hz,
                    pv
                ));
            }
        }
        prev = Some(p.frequency_hz);
    }

    GridOutcome {
        points,
        warnings,
        ignored_lines: ignored,
        header: header_desc,
        interpolation_guess: None,
    }
}

fn numeric_cells(row: &[String]) -> Vec<(usize, f64)> {
    row.iter()
        .enumerate()
        .filter_map(|(i, cell)| parse_number_cell(cell).map(|v| (i, v)))
        .collect()
}

fn detect_index_column(candidates: &[(usize, Vec<(usize, f64)>)]) -> bool {
    if candidates.is_empty() {
        return false;
    }
    if candidates.iter().any(|(_, v)| v.len() < 3) {
        return false;
    }
    if !candidates.iter().all(|(_, v)| is_integer(v[0].1)) {
        return false;
    }
    if candidates.len() == 1 {
        return true;
    }
    candidates.windows(2).all(|w| {
        let a = w[0].1[0].1;
        let b = w[1].1[0].1;
        is_integer(a) && is_integer(b) && ((b - a) - 1.0).abs() < 1e-9
    })
}

fn is_integer(v: f64) -> bool {
    v.is_finite() && (v - v.round()).abs() < 1e-9
}

/// Read the leading numeric token of a cell, tolerating units and full-width
/// punctuation. Returns None for empty / placeholder cells.
pub fn parse_number_cell(raw: &str) -> Option<f64> {
    let cleaned = raw.replace('\u{feff}', "").replace('　', " ");
    let s = cleaned.trim();
    if s.is_empty() {
        return None;
    }
    let lower = s.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "-" | "--" | "—" | "–" | "/" | "n/a" | "na" | "nan" | "null" | "none"
    ) {
        return None;
    }

    // A numeric cell must *start* with a number. This rejects unit-only tokens
    // such as "g^2/Hz" (whose stray "2" must not be read as a value) while
    // still accepting "10 Hz", "0.003 g^2/Hz", "-2.5" and ".5".
    let chars: Vec<char> = s.chars().collect();
    let first = chars[0];
    let starts_numeric = first.is_ascii_digit()
        || ((first == '+' || first == '-' || first == '.')
            && chars.len() > 1
            && chars[1].is_ascii_digit());
    if !starts_numeric {
        return None;
    }
    let mut i = 0usize;
    let mut num = String::new();
    if chars[i] == '+' || chars[i] == '-' {
        num.push(chars[i]);
        i += 1;
    }
    let mut seen_dot = false;
    let mut seen_digit = false;
    while i < chars.len() {
        let ch = chars[i];
        if ch.is_ascii_digit() {
            seen_digit = true;
            num.push(ch);
            i += 1;
        } else if ch == '.' && !seen_dot {
            seen_dot = true;
            num.push('.');
            i += 1;
        } else if (ch == 'e' || ch == 'E') && seen_digit {
            let mut j = i + 1;
            let mut sign = String::new();
            if j < chars.len() && (chars[j] == '+' || chars[j] == '-') {
                sign.push(chars[j]);
                j += 1;
            }
            if j < chars.len() && chars[j].is_ascii_digit() {
                num.push('e');
                num.push_str(&sign);
                i = j;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    num.push(chars[i]);
                    i += 1;
                }
            }
            break;
        } else {
            break;
        }
    }
    if !seen_digit {
        return None;
    }
    if num.starts_with('.') {
        num.insert(0, '0');
    } else if num.starts_with("-.") {
        num.insert(1, '0');
    } else if num.starts_with("+.") {
        num.insert(1, '0');
    }
    num.parse::<f64>().ok().filter(|v| v.is_finite())
}

fn is_freq_header(cell: &str) -> bool {
    let n = normalize_header(cell);
    if n.is_empty() {
        return false;
    }
    n.starts_with("频率")
        || n.starts_with("freq")
        || matches!(
            n.as_str(),
            "f" | "x" | "hz" | "频率" | "频率值" | "x轴" | "横轴" | "横坐标" | "x坐标" | "fhz"
        )
}

fn is_psd_header(cell: &str) -> bool {
    let n = normalize_header(cell);
    if n.is_empty() {
        return false;
    }
    n.starts_with("psd")
        || n.starts_with("功率谱")
        || n.starts_with("加速度谱")
        || n.contains("谱密度")
        || matches!(n.as_str(), "谱值" | "asd" | "g2hz" | "g2hz值")
}

fn normalize_header(input: &str) -> String {
    let mut out = String::new();
    for ch in input.chars() {
        let mapped = match ch {
            '²' => Some('2'),
            '³' => Some('3'),
            _ => None,
        };
        if let Some(c) = mapped {
            out.push(c);
            continue;
        }
        let lower = ch.to_ascii_lowercase();
        if lower.is_whitespace() {
            continue;
        }
        if matches!(
            lower,
            '_' | '-'
                | '/'
                | '\\'
                | '('
                | ')'
                | '（'
                | '）'
                | '['
                | ']'
                | '【'
                | '】'
                | ':'
                | '：'
                | '^'
                | '|'
                | '\u{3000}'
        ) {
            continue;
        }
        out.push(lower);
    }
    out
}

fn detect_delimiter(lines: &[&str]) -> char {
    let mut tab = 0usize;
    let mut comma = 0usize;
    let mut semi = 0usize;
    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("//") {
            continue;
        }
        if trimmed.contains('\t') {
            tab += 1;
        } else if trimmed.contains(',') {
            comma += 1;
        } else if trimmed.contains(';') {
            semi += 1;
        }
    }
    if tab == 0 && comma == 0 && semi == 0 {
        return ' '; // whitespace
    }
    if tab >= comma && tab >= semi {
        '\t'
    } else if comma >= semi {
        ','
    } else {
        ';'
    }
}

fn delimiter_name(delimiter: char) -> String {
    match delimiter {
        '\t' => "tab",
        ',' => "comma",
        ';' => "semicolon",
        _ => "whitespace",
    }
    .to_string()
}

fn split_fields(line: &str, delimiter: char) -> Vec<String> {
    match delimiter {
        '\t' => line.split('\t').map(|s| s.to_string()).collect(),
        ',' => line.split(',').map(|s| s.to_string()).collect(),
        ';' => line.split(';').map(|s| s.to_string()).collect(),
        _ => line.split_whitespace().map(|s| s.to_string()).collect(),
    }
}

fn guess_interpolation(text: &str) -> Option<String> {
    let upper = text.to_ascii_uppercase();
    let compact = upper.replace([' ', '_', '/', '-'], "");
    if compact.contains("LINEARLINEAR") || compact.contains("线性-线性") || compact.contains("线性线性") {
        return Some("LINEAR-LINEAR".into());
    }
    if compact.contains("LOGLINEAR") {
        return Some("LOG-LINEAR".into());
    }
    if compact.contains("LINEARLOG") {
        return Some("LINEAR-LOG".into());
    }
    if compact.contains("LOGLOG") || compact.contains("对数-对数") || compact.contains("对数对数") {
        return Some("LOG-LOG".into());
    }
    None
}

fn data_to_string(data: &calamine::Data) -> String {
    use calamine::Data;
    match data {
        Data::Empty => String::new(),
        Data::String(s) => s.clone(),
        Data::Float(f) => format!("{f}"),
        Data::Int(i) => format!("{i}"),
        Data::Bool(b) => format!("{b}"),
        Data::DateTimeIso(s) => s.clone(),
        Data::DurationIso(s) => s.clone(),
        Data::DateTime(_) => String::new(),
        Data::Error(_) => String::new(),
    }
}
