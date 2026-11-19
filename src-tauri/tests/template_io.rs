use std::fs;

use loadcreator_app_lib::commands::project::{read_text_file, save_text_file};

#[test]
fn save_and_read_xml_template_round_trips_and_strips_bom() {
    let dir = std::env::temp_dir().join(format!("lc_tpl_test_{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let target = dir.join("test_template.xml");

    let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<LoadCreatorTemplate schemaVersion=\"1\">\n  <modules>\n    <module id=\"tabular-load\">\n      <source type=\"string\">case1\t静满载\nline2</source>\n    </module>\n  </modules>\n</LoadCreatorTemplate>\n";
    let written = save_text_file(target.to_string_lossy().into_owned(), xml.to_string()).unwrap();
    assert_eq!(written, target.to_string_lossy());

    let read_back = read_text_file(target.to_string_lossy().into_owned()).unwrap();
    assert_eq!(read_back, xml);

    // Overwrite atomically and verify BOM stripping.
    let with_bom = format!("\u{FEFF}{xml}");
    save_text_file(target.to_string_lossy().into_owned(), with_bom).unwrap();
    let stripped = read_text_file(target.to_string_lossy().into_owned()).unwrap();
    assert_eq!(stripped, xml);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn save_text_file_rejects_missing_parent_directory() {
    let bad = std::env::temp_dir()
        .join("nonexistent_lc_tpl_dir_999999")
        .join("tpl.xml");
    let err = save_text_file(bad.to_string_lossy().into_owned(), "<a/>".into()).unwrap_err();
    assert!(err.contains("不存在"));
}
