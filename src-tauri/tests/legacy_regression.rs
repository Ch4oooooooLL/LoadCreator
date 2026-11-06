#![allow(clippy::too_many_arguments)]

//! Legacy tabular-load regression tests.
//!
//! These live in an integration-test target so the windows-gnu Common-Controls
//! v6 manifest is linked (see `src-tauri/build.rs`). They pin the behaviour of
//! the original `load_deck` module and must keep passing after the 2.0 kernel
//! migration; the legacy code path is the compatibility baseline.

use std::collections::BTreeMap;

use loadcreator_app_lib::load_deck::{
    build_load_deck, fmt, mapped_case_name, parse_clipboard_table, BuildRequest, LoadRow,
};

fn row(
    source_line: usize,
    case_name: &str,
    point_name: &str,
    display_name: &str,
    x: f64,
    y: f64,
    z: f64,
    fx: f64,
    fy: f64,
    fz: f64,
) -> LoadRow {
    LoadRow {
        source_line,
        case_name: case_name.into(),
        group_name: String::new(),
        point_name: point_name.into(),
        display_name: display_name.into(),
        x,
        y,
        z,
        time: None,
        fx,
        fy,
        fz,
        tx: 0.0,
        ty: 0.0,
        tz: 0.0,
    }
}

#[test]
fn parses_explicit_headers_and_builds_nodes_by_point_name() {
    let text = "case1 braking\nGroup\tX\tY\tZ\tEnglish Name\t中文名\tTime\tFX\tFY\tFZ\tTX\tTY\tTZ\nfront\t1\t2\t3\tfront_left\t左侧\t7\t10\t0\t-20\t0\t5\t0\n\t1\t2\t3\talias\t重复\t7\t0\t1\t0\t0\t0\t0";
    let parsed = parse_clipboard_table(text.into()).unwrap();
    assert_eq!(parsed.rows.len(), 2);
    let built = build_load_deck(BuildRequest {
        project_name: "demo".into(),
        rows: parsed.rows,
        case_aliases: BTreeMap::new(),
        coordinate_tolerance: 1e-6,
    })
    .unwrap();
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
        row(
            16,
            "case1",
            "rear_left",
            "后桥缓冲块左",
            5061.0,
            -518.0,
            137.0,
            1.0,
            0.0,
            0.0,
        ),
        row(
            17,
            "case1",
            "rear_right",
            "后桥缓冲块右",
            5061.0,
            -518.0,
            137.0,
            1.0,
            0.0,
            0.0,
        ),
    ];
    let built = build_load_deck(BuildRequest {
        project_name: "demo".into(),
        rows,
        case_aliases: BTreeMap::new(),
        coordinate_tolerance: 1e-6,
    })
    .unwrap();
    assert_eq!(built.points.len(), 2);
    assert!(built.warnings[0].contains("第 1 条数据"));
    assert!(built.warnings[0].contains("第 2 条数据"));
    assert!(built.warnings[0].contains("分别生成节点和 JSON 记录"));
}

#[test]
fn keeps_chinese_case_names_in_ui_but_writes_ascii_fem_aliases() {
    let r = row(
        3,
        "case1 静载工况（前轮1g）",
        "point_a",
        "",
        1.0,
        2.0,
        3.0,
        1.0,
        0.0,
        0.0,
    );
    let aliases = BTreeMap::from([(
        "case1 静载工况（前轮1g）".to_string(),
        "static_front_1g".to_string(),
    )]);
    let built = build_load_deck(BuildRequest {
        project_name: "中文项目".into(),
        rows: vec![r],
        case_aliases: aliases,
        coordinate_tolerance: 1e-6,
    })
    .unwrap();
    assert_eq!(built.cases[0].name, "case1 静载工况（前轮1g）");
    assert_eq!(built.cases[0].fem_name, "static_front_1g");
    assert!(built.fem.is_ascii());
    assert!(built.fem.contains("LABEL = LS_001_static_front_1g"));
    assert!(built.fem.contains("\"LC_001_static_front_1g\""));
}

#[test]
fn groups_by_chinese_name_and_warns_about_conflicting_english_names() {
    let rows = vec![
        row(
            3,
            "case1",
            "point_a",
            "连接点",
            1.0,
            2.0,
            3.0,
            1.0,
            0.0,
            0.0,
        ),
        row(
            6,
            "case2",
            "point_b",
            "连接点",
            1.0,
            2.0,
            3.0,
            1.0,
            0.0,
            0.0,
        ),
    ];
    let built = build_load_deck(BuildRequest {
        project_name: "demo".into(),
        rows,
        case_aliases: BTreeMap::new(),
        coordinate_tolerance: 1e-6,
    })
    .unwrap();
    assert_eq!(built.points.len(), 1);
    assert_eq!(built.points[0].name, "连接点");
    assert_eq!(built.points[0].english_name, "point_a");
    assert!(built
        .warnings
        .iter()
        .any(|w| w.contains("对应了不同英文名")));
    assert!(built.json.contains("\"point_a\""));
}

#[test]
fn preserves_json_entries_when_chinese_points_share_an_english_name() {
    let rows = vec![
        row(3, "case1", "shared", "左点", 1.0, -2.0, 3.0, 1.0, 0.0, 0.0),
        row(4, "case1", "shared", "右点", 1.0, 2.0, 3.0, 1.0, 0.0, 0.0),
    ];
    let built = build_load_deck(BuildRequest {
        project_name: "demo".into(),
        rows,
        case_aliases: BTreeMap::new(),
        coordinate_tolerance: 1e-6,
    })
    .unwrap();
    assert_eq!(built.points.len(), 2);
    assert!(built
        .warnings
        .iter()
        .any(|w| w.contains("使用了相同英文名")));
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
        (
            "case11 左前轮上跳&右后轮上跳",
            "Front_Left_and_Rear_Right_Bump",
        ),
        (
            "case12 右前轮上跳&左后轮上跳",
            "Front_Right_and_Rear_Left_Bump",
        ),
        ("case13 转弯（左转）", "Left_Turn"),
        ("case14 制动 整车质心减速度0.15g", "Braking_0.15g"),
        ("case15 制动 整车质心减速度0.2g", "Braking_0.2g"),
        ("case16 加速 整车质心加速度0.15g", "Acceleration_0.15g"),
    ];
    for (source, expected) in cases {
        assert_eq!(
            mapped_case_name(source).as_deref(),
            Some(expected),
            "{source}"
        );
    }
}

#[test]
fn recognises_chinese_name_header_variant() {
    let text = "case1_braking\nGroup\tX\tY\tZ\tEnglish Name\t中文名称\tTime\tFX\tFY\tFZ\tTX\tTY\tTZ\nfront\t1550\t0\t-210\tfrontsusp_a\t前悬架连接点\t7\t-385\t-4150\t35600\t0\t0\t0";
    let parsed = parse_clipboard_table(text.into()).unwrap();
    assert_eq!(parsed.rows.len(), 1);
    assert_eq!(parsed.rows[0].display_name, "前悬架连接点");
    let built = build_load_deck(BuildRequest {
        project_name: "demo".into(),
        rows: parsed.rows,
        case_aliases: BTreeMap::new(),
        coordinate_tolerance: 1e-6,
    })
    .unwrap();
    assert_eq!(built.points[0].name, "前悬架连接点");
    assert!(!parsed.warnings.iter().any(|w| w.contains("缺少中文名称")));
}

#[test]
fn keeps_columns_when_a_case_title_has_no_repeated_header() {
    let text = "case1 静载工况\nGroup\tX\tY\tZ\tEnglish Name\t中文名称\tFX\tFY\tFZ\nfront\t1\t2\t3\ta\t甲\t1\t0\t0\ncase2 制动0.15g\n\t4\t5\t6\tb\t乙\t0\t2\t0";
    let parsed = parse_clipboard_table(text.into()).unwrap();
    assert_eq!(parsed.rows.len(), 2);
    assert_eq!(parsed.rows[1].case_name, "case2 制动0.15g");
    assert_eq!(parsed.rows[1].point_name, "b");
    assert_eq!(parsed.rows[1].display_name, "乙");
}

#[test]
fn ignores_short_tail_lines_instead_of_creating_zero_rows() {
    let text = "case1\nGroup\tX\tY\tZ\tEnglish Name\t中文名称\tFX\tFY\tFZ\nfront\t1\t2\t3\ta\t甲\t1\t0\t0\n备注：以上数据仅供参考";
    let parsed = parse_clipboard_table(text.into()).unwrap();
    assert_eq!(parsed.rows.len(), 1);
    assert!(parsed.ignored_lines >= 1);
}

#[test]
fn formats_loads_as_plain_decimals_for_nastran() {
    assert_eq!(fmt(0.0), "0.0");
    assert_eq!(fmt(-4150.0), "-4150.0");
    assert_eq!(fmt(35600.0), "35600.0");
    assert_eq!(fmt(0.15), "0.15");
    assert_eq!(fmt(1e-7), "0.0000001");
    let mut r = row(
        1, "case1", "p", "点", 1.0, 2.0, 3.0, -385.0, -4150.0, 35600.0,
    );
    r.tx = 0.15;
    let built = build_load_deck(BuildRequest {
        project_name: "demo".into(),
        rows: vec![r],
        case_aliases: BTreeMap::new(),
        coordinate_tolerance: 1e-6,
    })
    .unwrap();
    assert!(built
        .fem
        .contains("FORCE,100001,1001,0,1.0,-385.0,-4150.0,35600.0"));
    assert!(built.fem.contains("MOMENT,100001,1001,0,1.0,0.15,0.0,0.0"));
    assert!(!built.fem.contains("e3") && !built.fem.contains("e4"));
}
