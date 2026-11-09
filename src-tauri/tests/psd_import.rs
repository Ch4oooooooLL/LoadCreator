//! Unit tests for the PSD spectrum importer (CSV / TXT / XLSX).
//!
//! These run offline and only exercise the recognition rules; they do not touch
//! any solver or output file.

use std::fs;

use loadcreator_app_lib::core::psd_import;

fn values(text: &str) -> Vec<(f64, f64)> {
    psd_import::parse_spectrum_text(text)
        .points
        .into_iter()
        .map(|p| (p.frequency_hz, p.psd))
        .collect()
}

#[test]
fn parses_csv_with_header_and_comments() {
    let text = "\u{feff}# PSD template\n# comment with 频率 PSD words\n频率Hz,PSD(g^2/Hz)\n10,0.003\n20,0.01\n50,0.02\n";
    let result = psd_import::parse_spectrum_text(text);
    assert_eq!(result.points.len(), 3, "warnings: {:?}", result.warnings);
    assert_eq!(result.points[0].frequency_hz, 10.0);
    assert_eq!(result.points[0].psd, 0.003);
    assert_eq!(result.source_kind, "txt"); // caller overrides to csv
    assert_eq!(result.delimiter.as_deref(), Some("comma"));
    assert!(result.header.is_some());
}

#[test]
fn parses_english_header_with_extra_columns() {
    let text = "Index,Frequency (Hz),Damping,PSD (g^2/Hz)\n1,10,0.02,0.003\n2,20,0.02,0.01\n";
    let pts = values(text);
    assert_eq!(pts, vec![(10.0, 0.003), (20.0, 0.01)]);
}

#[test]
fn parses_headerless_tab_with_units() {
    let text = "10\t0.003\n20\t0.01\n50\t0.02\n";
    let pts = values(text);
    assert_eq!(pts, vec![(10.0, 0.003), (20.0, 0.01), (50.0, 0.02)]);
}

#[test]
fn parses_headerless_space_two_columns() {
    let text = "1.0 1.0\n10.0 0.1\n100.0 0.01\n";
    let pts = values(text);
    assert_eq!(pts.len(), 3);
    assert_eq!(pts[1], (10.0, 0.1));
}

#[test]
fn detects_and_skips_sequence_index_column() {
    // Three numeric columns: sequence, frequency, PSD.
    let text = "1 10 0.003\n2 20 0.01\n3 50 0.02\n";
    let result = psd_import::parse_spectrum_text(text);
    let pts: Vec<(f64, f64)> = result
        .points
        .iter()
        .map(|p| (p.frequency_hz, p.psd))
        .collect();
    assert_eq!(pts, vec![(10.0, 0.003), (20.0, 0.01), (50.0, 0.02)]);
    assert!(result.warnings.iter().any(|w| w.contains("序号")));
}

#[test]
fn parses_chinese_header_with_units() {
    let text = "频率(Hz)\t加速度功率谱密度(g²/Hz)\n10\t0.003\n20\t0.01\n";
    let pts = values(text);
    assert_eq!(pts, vec![(10.0, 0.003), (20.0, 0.01)]);
}

#[test]
fn guesses_interpolation_from_text() {
    let text = "# 插值: LOG-LOG\n频率Hz,PSD\n10,0.003\n20,0.01\n";
    let result = psd_import::parse_spectrum_text(text);
    assert_eq!(result.interpolation_guess.as_deref(), Some("LOG-LOG"));
}

#[test]
fn number_cell_handles_units_and_placeholders() {
    assert_eq!(psd_import::parse_number_cell("10 Hz"), Some(10.0));
    assert_eq!(psd_import::parse_number_cell("0.003 g^2/Hz"), Some(0.003));
    assert_eq!(psd_import::parse_number_cell("1.5e-3"), Some(1.5e-3));
    assert_eq!(psd_import::parse_number_cell("-2.5"), Some(-2.5));
    assert_eq!(psd_import::parse_number_cell(""), None);
    assert_eq!(psd_import::parse_number_cell("N/A"), None);
    assert_eq!(psd_import::parse_number_cell("g^2/Hz"), None);
}

#[test]
fn template_csv_reimports_cleanly() {
    let csv = psd_import::template_csv();
    let result = psd_import::parse_spectrum_text(&csv);
    assert_eq!(result.points.len(), psd_import::TEMPLATE_POINTS.len());
    for (p, (f, q)) in result.points.iter().zip(psd_import::TEMPLATE_POINTS.iter()) {
        assert!((p.frequency_hz - f).abs() < 1e-9);
        assert!((p.psd - q).abs() < 1e-12);
    }
}

#[test]
fn xlsx_template_round_trips() {
    let bytes = psd_import::template_xlsx_bytes().expect("template xlsx");
    let mut path = std::env::temp_dir();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    path.push(format!("loadcreator_psd_tpl_{stamp}.xlsx"));
    fs::write(&path, &bytes).expect("write temp xlsx");
    let result = psd_import::parse_spreadsheet_path(&path).expect("parse xlsx");
    let _ = fs::remove_file(&path);
    assert_eq!(result.points.len(), psd_import::TEMPLATE_POINTS.len());
    assert_eq!(result.points[0].frequency_hz, 10.0);
    assert!(result.sheet_name.is_some());
}

#[test]
fn command_reads_csv_file_end_to_end() {
    use loadcreator_app_lib::commands::psd::read_psd_spectrum_file;

    let mut path = std::env::temp_dir();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    path.push(format!("loadcreator_psd_read_{stamp}.csv"));
    fs::write(
        &path,
        "频率Hz,PSD(g^2/Hz)\n10,0.003\n20,0.01\n50,0.02\n",
    )
    .unwrap();
    let result = read_psd_spectrum_file(path.to_string_lossy().into_owned()).unwrap();
    let _ = fs::remove_file(&path);
    assert_eq!(result.points.len(), 3);
    assert_eq!(result.source_kind, "csv");
    assert_eq!(result.points[2].frequency_hz, 50.0);
}

#[test]
fn command_writes_and_reads_csv_template() {
    use loadcreator_app_lib::commands::psd::{read_psd_spectrum_file, write_psd_template};

    let mut path = std::env::temp_dir();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    path.push(format!("loadcreator_psd_tpl_{stamp}.csv"));
    let written = write_psd_template(path.to_string_lossy().into_owned(), "csv".into()).unwrap();
    let result = read_psd_spectrum_file(written).unwrap();
    let _ = fs::remove_file(&path);
    assert_eq!(result.points.len(), psd_import::TEMPLATE_POINTS.len());
}

#[test]
fn command_rejects_unsupported_extension() {
    use loadcreator_app_lib::commands::psd::read_psd_spectrum_file;
    let mut path = std::env::temp_dir();
    path.push("loadcreator_psd_bad.json");
    fs::write(&path, "{}").unwrap();
    let err = read_psd_spectrum_file(path.to_string_lossy().into_owned()).unwrap_err();
    let _ = fs::remove_file(&path);
    assert!(err.contains("不支持"));
}
