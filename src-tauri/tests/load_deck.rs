use loadcreator_app_lib::load_deck::{
    build_load_deck, parse_clipboard_table, validate_load_rows, BuildRequest,
    ValidateRowsRequest, WarningSeverity, WarningTargetKind,
};

#[test]
fn parses_and_builds_a_grid_free_deck() {
    let text = "case1 braking\nGroup\tX\tY\tZ\tEnglish Name\t中文名\tTime\tFX\tFY\tFZ\tTX\tTY\tTZ\nfront\t1\t2\t3\tfront_left\t左侧\t7\t10\t0\t-20\t0\t5\t0\n\t1\t2\t3\talias\t重复\t7\t0\t1\t0\t0\t0\t0";
    let parsed = parse_clipboard_table(text.into()).unwrap();
    let built = build_load_deck(BuildRequest {
        project_name: "demo".into(),
        rows: parsed.rows,
        case_aliases: Default::default(),
        coordinate_tolerance: 1e-6,
    })
    .unwrap();

    assert_eq!(built.points.len(), 2);
    assert!(!built.fem.contains("GRID,"));
    assert!(built.fem.contains("FORCE,100001,1001"));
    assert!(built.fem.contains("MOMENT,100001,1001"));
    assert!(built.json.contains("front_left_1001"));
}

#[test]
fn parses_a_merged_coordinate_header() {
    let text = "case13 steering\n分组\t落点坐标\t\t\t\t落点名称\t序号\t时间\tFX\tFY\tFZ\tTX\tTY\tTZ\nfront\t1550\t0\t-210\tfrontsusp_a\t前悬\t1\t7\t-3.85e2\t-4.15e3\t3.56e4\t0\t0\t0";
    let parsed = parse_clipboard_table(text.into()).unwrap();
    assert_eq!(parsed.rows[0].point_name, "frontsusp_a");
    assert_eq!(parsed.rows[0].x, 1550.0);
    assert_eq!(parsed.rows[0].fz, 35600.0);
}

#[test]
fn parse_warnings_include_ignored_source_line_targets() {
    let text = "先导垃圾行\ncase1\nGroup\tX\tY\tZ\tEnglish Name\t中文名\tFX\tFY\tFZ\nfront\t1\t2\t3\tleft\t左点\t10\t0\t0\nfront\tbad_x\t2\t3\tright\t右点\t10\t0\t0";
    let parsed = parse_clipboard_table(text.into()).unwrap();
    assert_eq!(parsed.ignored_lines, 2);
    assert_eq!(parsed.warning_items.len(), 1);
    let item = &parsed.warning_items[0];
    assert_eq!(item.code, "PARSE_IGNORED_LINES");
    assert_eq!(item.targets.len(), 2);
    assert_eq!(item.targets[0].kind, WarningTargetKind::SourceLine);
    assert_eq!(item.targets[0].source_line, Some(1));
    assert_eq!(item.targets[1].source_line, Some(5));
}

#[test]
fn validate_and_build_emit_structured_cell_targets() {
    let text = "case1\nGroup\tX\tY\tZ\tEnglish Name\t中文名\tFX\tFY\tFZ\nfront\t100\t200\t300\tshared_pt\t左点\t10\t0\t0\nfront\t100\t250\t300\tshared_pt\t左点\t20\t0\t0\nfront\t100\t200\t300\t右 英文\t右点\t30\t0\t0";
    let parsed = parse_clipboard_table(text.into()).unwrap();
    let mut rows = parsed.rows;
    rows[2].display_name = "".into();

    let validated = validate_load_rows(ValidateRowsRequest {
        rows: rows.clone(),
        coordinate_tolerance: 1e-6,
    });
    assert!(validated
        .warning_items
        .iter()
        .any(|w| w.code == "INCONSISTENT_COORDINATES"
            && w.targets.len() == 2
            && w.targets[0].row_index == Some(0)
            && w.targets[1].row_index == Some(1)
            && w.targets[0].fields == vec!["y".to_string()]));
    assert!(validated
        .warning_items
        .iter()
        .any(|w| w.code == "MISSING_DISPLAY_NAME"
            && w.targets[0].row_index == Some(2)
            && w.targets[0].fields == vec!["displayName".to_string()]));
    assert!(validated
        .warning_items
        .iter()
        .any(|w| w.code == "INVALID_POINT_NAME"
            && w.targets[0].row_index == Some(2)
            && w.targets[0].fields == vec!["pointName".to_string()]));

    rows[0].fx = f64::NAN;
    let err_validated = validate_load_rows(ValidateRowsRequest {
        rows: rows.clone(),
        coordinate_tolerance: 1e-6,
    });
    assert!(err_validated
        .warning_items
        .iter()
        .any(|w| w.code == "NON_FINITE_VALUE"
            && w.severity == WarningSeverity::Error
            && w.targets[0].row_index == Some(0)
            && w.targets[0].fields == vec!["fx".to_string()]));
}
