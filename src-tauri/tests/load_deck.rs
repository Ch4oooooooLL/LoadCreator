use loadcreator_app_lib::load_deck::{build_load_deck, parse_clipboard_table, BuildRequest};

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
