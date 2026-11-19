//! Radioss ROPS increment tests (L1/L2 only: generation + text structure).
//!
//! These prove "Generated" text only. HyperMesh 2023.0 append-import (P0) and
//! Radioss 2022 solve are NOT executed here and remain pending.

use serde_json::json;

use loadcreator_app_lib::commands::case::{build_case, preview_case, CaseRequest};
use loadcreator_app_lib::core::radioss_deck::{RadIdKind, RadiossIdAllocator};

fn rops_request() -> CaseRequest {
    serde_json::from_value(json!({
        "projectName": "ROPS_Demo",
        "case": {
            "kind": "radioss-rops",
            "parameters": {
                "name": "ROPS_CASE_1",
                "runName": "ROPS_CASE",
                "solver": "radioss",
                "solverVersion": "2022",
                "units": {
                    "input": { "mass": "kg", "length": "mm", "time": "ms" },
                    "work": { "mass": "kg", "length": "mm", "time": "ms" },
                    "confirmedAgainstTargetModel": true
                },
                "references": {
                    "loadTarget": { "kind": "node", "nodeId": 1001 },
                    "constraints": [
                        { "target": { "kind": "nodes", "nodeIds": [2001, 2002] }, "dofs": [true, true, true, false, false, false] }
                    ]
                },
                "loading": {
                    "direction": "X",
                    "curve": [
                        { "time": 0.0, "value": 0.0 },
                        { "time": 0.05, "value": 40.0 },
                        { "time": 0.1, "value": 40.0 }
                    ]
                },
                "engine": {
                    "endTime": 0.1,
                    "animation": { "startTime": 0.0, "interval": 0.01 },
                    "timeHistoryInterval": 0.001,
                    "timeStep": { "mode": "natural" }
                },
                "idPolicy": { "generatedStart": 800000 }
            }
        }
    }))
    .unwrap()
}

#[test]
fn rops_builds_single_file_increment() {
    let preview = preview_case(rops_request());
    assert!(
        preview.summary.can_export,
        "diagnostics: {:?}",
        preview.diagnostics
    );
    let fem = &preview.fem_preview;
    assert!(fem.starts_with("# RADIOSS\n"));
    assert!(fem.contains("/RUN/ROPS_CASE/1"));
    assert!(fem.contains("/ANIM/DT"));
    assert!(fem.contains("/TFILE"));
    assert!(fem.contains("/END/ENGINE"));
    assert!(fem.contains("/BEGIN"));
    assert!(fem.contains("/GRNOD/NODE/800001"));
    assert!(fem.contains("/FUNCT/810001"));
    assert!(fem.contains("/IMPDISP/820001"));
    assert!(fem.contains("/BCS/830001"));
    assert!(fem.trim_end().ends_with("/END"));
    // Exactly one Engine terminator, one Begin, one End-block.
    assert_eq!(fem.matches("/END/ENGINE").count(), 1);
    assert_eq!(fem.matches("/BEGIN").count(), 1);
    // No mesh / no OptiStruct syntax.
    assert!(!fem.lines().any(|l| l.starts_with("/NODE/")), "must not define /NODE");
    assert!(!fem.contains("BEGIN BULK"));
    assert!(!fem.contains("SUBCASE"));
    assert!(!fem.contains("SOL 101"));
    // Direction is right justified in the 10-char Dir field before the group id.
    // 10-char group id: "    800001"; Dir field: "         X".
    assert!(fem.contains("    810001         X"));

    let build = build_case(rops_request());
    assert!(build.files.contains_key("ROPS_CASE_0000.rad"));
    assert!(build.files.contains_key("ROPS_CASE_0000.manifest.json"));
    assert!(build
        .external_references
        .iter()
        .any(|r| r.kind == "node" && r.id == 1001 && r.status == "UNVERIFIED_EXTERNAL"));
    assert!(build
        .external_references
        .iter()
        .any(|r| r.kind == "node" && r.id == 2002));
    assert!(build.id_plan.iter().any(|a| a.kind == "grnod" && a.id == 800001));
}

#[test]
fn rops_output_is_deterministic() {
    let a = build_case(rops_request());
    let b = build_case(rops_request());
    assert_eq!(a.files, b.files);
}

#[test]
fn radioss_export_names_match_begin_and_run() {
    use loadcreator_app_lib::core::case_spec::CaseSpec;
    let mut request = rops_request();
    let CaseSpec::RadiossRops(ref mut spec) = request.case else { unreachable!() };
    spec.run_name = format!("_{}", "ROPS_LOAD_".repeat(6));
    let run_name = spec.run_name.clone();
    let built = build_case(request);
    let deck = &built.files[&format!("{run_name}_0000.rad")];
    assert!(deck.contains(&format!("/RUN/{run_name}/1\n")));
    assert!(deck.contains(&format!("/BEGIN\n{run_name}\n")));
}

#[test]
fn radioss_configured_outputs_and_gravity_use_solver_fields() {
    use calamine::{Reader, Xlsx};
    use loadcreator_app_lib::core::case_spec::CaseSpec;
    use loadcreator_app_lib::core::radioss_functions_io::{extract_functions_from_deck, render_functions_xlsx_bytes};
    use loadcreator_app_lib::core::radioss_spec::{RadiossFopsSpec, RadiossImpact};
    use loadcreator_app_lib::modules::radioss_fops;
    use std::io::Cursor;

    let mut req = rops_request();
    let CaseSpec::RadiossRops(mut spec) = req.case else { unreachable!() };
    spec.engine.control = Some(serde_json::from_value(json!({
        "emitVers": true, "parith": false, "emitPrint": true, "nLine": 25,
        "tfileType": 4, "thVersion": 2021,
        "animElem": ["EPSP", "ENERGY", "ENER", "PRES", "LAW51_1", "BRICK/TENS/STRESS", "EPSX"],
        "animNoda": ["DMAS", "DAMA2"], "animVect": ["DISP", "CONT/MAX", "FREAC"]
    })).unwrap());
    spec.id_policy.manually_occupied_ranges = vec![[810001, 810003]];
    let gravity = json!({
        "enabled": true, "title": "GRAV_TEST", "mode": "curve", "direction": "-Z",
        "grnodId": 22, "skewId": 23, "sensorId": 24, "aScale": 2.0, "fScale": 0.00980665,
        "curve": [{"time": 0.0, "value": 0.0}, {"time": 0.05, "value": 1.0}]
    });
    let mut external_gravity = gravity.clone();
    external_gravity["title"] = json!("GRAV_EXTERNAL");
    external_gravity["existingFunctId"] = json!(12345);
    spec.gravities = serde_json::from_value(json!([gravity, external_gravity])).unwrap();
    spec.time_histories = serde_json::from_value(json!([
        {"kind":"spring", "variables":["FX","OFF"], "elements":[{"elemId":101,"label":"CAB_BOLT"}]},
        {"kind":"node", "role":"rwall-rbe2", "variables":["D","REACX","REACZZ"], "nodes":[{"nodeId":102,"label":"RBE2_MAIN"}]},
        {"kind":"rbody", "variables":["DEF"], "objectIds":[103]},
        {"kind":"rwall", "variables":["FN"], "objectIds":[104]}
    ])).unwrap();
    let fops = RadiossFopsSpec {
        base: spec,
        impact: RadiossImpact { drop_mass_kg: 300.0, drop_height_mm: 3000.0, gravity_g: 1.0 },
    };
    let functions = extract_functions_from_deck(&radioss_fops::generate(&fops).deck);
    let bytes = render_functions_xlsx_bytes(&functions).unwrap();
    let mut workbook = Xlsx::new(Cursor::new(bytes)).unwrap();
    let gravity_sheet = workbook.worksheet_range("810005_GRAV_TEST_FUNCT").unwrap();
    assert_eq!(gravity_sheet.get_size(), (3, 2));
    assert_eq!(gravity_sheet.get_value((2, 1)), Some(&calamine::Data::Float(1.0)));
    req.case = CaseSpec::RadiossFops(fops);

    let preview = preview_case(req);
    assert!(preview.summary.can_export, "{:?}", preview.diagnostics);
    let deck = &preview.fem_preview;
    for keyword in ["/VERS/2022", "/PARITH/OFF", "/PRINT/-1000/25", "/TFILE/4", "/TH/VERS/2021",
        "/ANIM/ELEM/ENER", "/ANIM/ELEM/P", "/ANIM/ELEM/LAW51/1", "/ANIM/BRICK/TENS/STRESS",
        "/ANIM/TRUSS/EPSX", "/ANIM/NODA/DMAS", "/ANIM/NODA/DAMA2", "/ANIM/VECT/CONT/MAX",
        "/ANIM/VECT/FREAC"] {
        assert!(deck.lines().any(|line| line == keyword), "missing {keyword}");
    }
    assert_eq!(deck.lines().filter(|line| *line == "/ANIM/ELEM/ENER").count(), 1);
    assert!(deck.contains("/TH/SPRING/870001\n") && deck.contains("       101          CAB_BOLT"));
    assert!(deck.contains("/TH/NODE/870002\n") && deck.contains("       102         0RBE2_MAIN"));
    assert!(deck.contains("/TH/RBODY/870003\n") && deck.contains("/TH/RWALL/870004\n"));
    let row = deck.lines().skip_while(|line| *line != "GRAV_TEST").nth(1).unwrap();
    assert_eq!(row.len(), 100);
    assert_eq!(row[..60].split_whitespace().collect::<Vec<_>>(), ["810005", "Z", "23", "24", "22"]);
    assert_eq!(&row[50..60], "          ");
    assert_eq!(row[60..80].trim(), "2.0");
    assert_eq!(row[80..].trim(), "-0.00980665");
    assert!(!deck.contains("GRAV_EXTERNAL_FUNCT"));
    assert!(preview.external_references.iter().any(|reference| reference.kind == "funct" && reference.id == 12345));
    let csv = preview.functions_csv.unwrap();
    assert!(csv.contains("810004,ROPS_CASE_1_DISP") && csv.contains("810005,GRAV_TEST_FUNCT"));
}

#[test]
fn rops_rejects_duplicate_curve_times() {
    let mut req = rops_request();
    if let loadcreator_app_lib::core::case_spec::CaseSpec::RadiossRops(ref mut s) = req.case {
        s.loading.curve[1].time = 0.0;
    }
    let report = preview_case(req);
    assert!(!report.summary.can_export);
    assert!(report.diagnostics.iter().any(|d| d.code == "LC-CURVE-001"));
}

#[test]
fn rops_rejects_unit_mismatch_and_missing_confirmation() {
    let mut req = rops_request();
    if let loadcreator_app_lib::core::case_spec::CaseSpec::RadiossRops(ref mut s) = req.case {
        s.units.work.time = "s".into();
        s.units.confirmed_against_target_model = false;
    }
    let report = preview_case(req);
    assert!(!report.summary.can_export);
    assert!(report.diagnostics.iter().any(|d| d.code == "LC-UNIT-001"));
}

#[test]
fn rops_rejects_load_constraint_dof_conflict() {
    let mut req = rops_request();
    if let loadcreator_app_lib::core::case_spec::CaseSpec::RadiossRops(ref mut s) = req.case {
        s.references.load_target = loadcreator_app_lib::core::radioss_spec::RadiossLoadTarget::Grnod { grnod_id: 5000 };
        s.references.constraints = vec![loadcreator_app_lib::core::radioss_spec::RadiossConstraint {
            target: loadcreator_app_lib::core::radioss_spec::RadiossConstraintTarget::Grnod { grnod_id: 5000 },
            dofs: [true, true, true, false, false, false],
            skew_id: None,
        }];
    }
    let report = preview_case(req);
    assert!(!report.summary.can_export);
    assert!(report
        .diagnostics
        .iter()
        .any(|d| d.code == "LC-CONFLICT-001"));
}

#[test]
fn rops_rejects_unsupported_version() {
    let mut req = rops_request();
    if let loadcreator_app_lib::core::case_spec::CaseSpec::RadiossRops(ref mut s) = req.case {
        s.solver_version = "2021".into();
    }
    let report = preview_case(req);
    assert!(!report.summary.can_export);
    assert!(report.diagnostics.iter().any(|d| d.code == "LC-COMPAT-001"));
}

#[test]
fn rops_ams_emits_paired_starter_and_engine() {
    let mut req = rops_request();
    if let loadcreator_app_lib::core::case_spec::CaseSpec::RadiossRops(ref mut s) = req.case {
        s.engine.time_step = loadcreator_app_lib::core::radioss_spec::RadiossTimeStep::Ams {
            scale: 0.9,
            target: 0.001,
            ams_part_group_id: None,
        };
    }
    let report = preview_case(req);
    assert!(report.summary.can_export, "{:?}", report.diagnostics);
    assert!(report.fem_preview.contains("/AMS"));
    assert!(report.fem_preview.contains("/DT/AMS"));
}

#[test]
fn id_allocator_skips_occupied_ranges() {
    let mut a = RadiossIdAllocator::new(800_000, &[[800_001, 800_001]]);
    assert_eq!(a.allocate(RadIdKind::Grnod, "load#grnod"), 800_002);
    // Deterministic / idempotent.
    assert_eq!(a.allocate(RadIdKind::Grnod, "load#grnod"), 800_002);
}

#[test]
fn rops_golden() {
    let built = build_case(rops_request());
    let rad = built
        .files
        .iter()
        .find(|(k, _)| k.ends_with(".rad"))
        .map(|(_, v)| v.clone())
        .expect("rad file");
    let expected = std::fs::read_to_string("fixtures/radioss_2022/rops_simple/expected.rad")
        .expect("missing radioss golden fixture");
    assert_eq!(rad, expected, "radioss golden mismatch");
}


#[test]
fn fops_builds_controlled_displacement_with_impact_check() {
    let req: CaseRequest = serde_json::from_value(json!({
        "projectName": "FOPS_Demo",
        "case": {
            "kind": "radioss-fops",
            "parameters": {
                "base": {
                    "name": "FOPS_CASE_1",
                    "runName": "FOPS_CASE",
                    "solver": "radioss",
                    "solverVersion": "2022",
                    "units": {
                        "input": { "mass": "kg", "length": "mm", "time": "ms" },
                        "work": { "mass": "kg", "length": "mm", "time": "ms" },
                        "confirmedAgainstTargetModel": true
                    },
                    "references": {
                        "loadTarget": { "kind": "node", "nodeId": 3001 },
                        "constraints": [
                            { "target": { "kind": "nodes", "nodeIds": [4001, 4002] },
                              "dofs": [true, true, true, true, true, true] }
                        ]
                    },
                    "loading": {
                        "direction": "Z",
                        "curve": [
                            { "time": 0.0, "value": 0.0 },
                            { "time": 0.01, "value": 30.0 },
                            { "time": 0.05, "value": 30.0 }
                        ]
                    },
                    "engine": {
                        "endTime": 0.05,
                        "animation": { "startTime": 0.0, "interval": 0.005 },
                        "timeHistoryInterval": 0.0005,
                        "timeStep": { "mode": "natural" }
                    },
                    "idPolicy": { "generatedStart": 800000, "manuallyOccupiedRanges": [] }
                },
                "impact": { "dropMassKg": 300.0, "dropHeightMm": 3000.0, "gravityG": 1.0 }
            }
        }
    }))
    .unwrap();
    let p = preview_case(req);
    assert!(p.summary.can_export, "diagnostics: {:?}", p.diagnostics);
    assert!(p.fem_preview.contains("/IMPDISP"));
    assert!(p.diagnostics.iter().any(|d| d.code == "LC-FOPS-002"));
}

#[test]
fn rops_supports_negative_axis_and_rotational_directions() {
    let mut req = rops_request();
    if let loadcreator_app_lib::core::case_spec::CaseSpec::RadiossRops(ref mut s) = req.case {
        s.loading.direction = "-Y".into();
    }
    let p = preview_case(req);
    assert!(p.summary.can_export, "diagnostics: {:?}", p.diagnostics);
    assert!(p.fem_preview.contains("    810001         Y"));
    assert!(p.fem_preview.contains("                 1.0                -1.0"));

    let mut req_rot = rops_request();
    if let loadcreator_app_lib::core::case_spec::CaseSpec::RadiossRops(ref mut s) = req_rot.case {
        s.loading.direction = "-ZZ".into();
    }
    let p_rot = preview_case(req_rot);
    assert!(p_rot.summary.can_export, "diagnostics: {:?}", p_rot.diagnostics);
    assert!(p_rot.fem_preview.contains("    810001        ZZ"));
    assert!(p_rot.fem_preview.contains("                 1.0                -1.0"));
}

#[test]
fn rops_supports_custom_direction_vector_via_skew_fix() {
    let mut req = rops_request();
    if let loadcreator_app_lib::core::case_spec::CaseSpec::RadiossRops(ref mut s) = req.case {
        s.loading.direction_mode = "vector".into();
        s.loading.direction_vector = Some([0.0, -0.866, -0.5]);
        s.loading.vector_origin = Some([10.0, 20.0, 30.0]);
    }
    let p = preview_case(req);
    assert!(p.summary.can_export, "diagnostics: {:?}", p.diagnostics);
    assert!(p.fem_preview.contains("/SKEW/FIX/860001"));
    assert!(p.fem_preview.contains("    810001         X    860001"));
    assert!(p.id_plan.iter().any(|a| a.kind == "skew" && a.id == 860001));

    // Zero vector must be rejected.
    let mut bad = rops_request();
    if let loadcreator_app_lib::core::case_spec::CaseSpec::RadiossRops(ref mut s) = bad.case {
        s.loading.direction_mode = "vector".into();
        s.loading.direction_vector = Some([0.0, 0.0, 0.0]);
    }
    let bad_p = preview_case(bad);
    assert!(!bad_p.summary.can_export);
    assert!(bad_p.diagnostics.iter().any(|d| d.code == "LC-INPUT-001"));
}

#[test]
fn rops_and_fops_emit_inter_type7_contact_and_validate_sets() {
    let contact_json = json!({
        "title": "TOOL_CAB_CONTACT",
        "slaveGrnodId": 101,
        "masterSurfId": 201,
        "istf": 4,
        "ithe": 0,
        "igap": 2,
        "ibag": 0,
        "idel": 2,
        "icurv": 0,
        "iadm": 0,
        "fscaleGap": 0.8,
        "gapMax": 0.0,
        "fpenmax": 0.0,
        "iTied": 0,
        "stMin": 0.0,
        "stMax": 0.0,
        "percentMeshSize": 0.4,
        "dtmin": 0.0,
        "iremGap": 2,
        "iremI2": 0,
        "stfac": 1.0,
        "fric": 0.15,
        "gapMin": 0.5,
        "tStart": 0.0,
        "tStop": 0.0,
        "ibc": "000",
        "inacti": 6,
        "visS": 0.0,
        "visF": 0.0,
        "bumult": 0.0,
        "ifric": 0,
        "ifiltr": 0,
        "xfreq": 0.0,
        "iform": 2,
        "sensId": 0,
        "fctIdF": 0,
        "ascaleF": 0.0,
        "fricId": 0
    });

    // ROPS with contact
    let mut req = rops_request();
    if let loadcreator_app_lib::core::case_spec::CaseSpec::RadiossRops(ref mut s) = req.case {
        let ct: loadcreator_app_lib::core::radioss_spec::RadiossContact =
            serde_json::from_value(contact_json.clone()).unwrap();
        s.contacts.push(ct);
    }
    let p = preview_case(req);
    assert!(p.summary.can_export, "diagnostics: {:?}", p.diagnostics);
    assert!(p.fem_preview.contains("/INTER/TYPE7/850001"));
    assert!(p.fem_preview.contains("TOOL_CAB_CONTACT"));
    assert_type7_columns(&p.fem_preview);
    assert!(p.external_references.iter().any(|r| r.kind == "grnod" && r.id == 101));
    assert!(p.external_references.iter().any(|r| r.kind == "surf" && r.id == 201));
    assert!(p.id_plan.iter().any(|a| a.kind == "inter" && a.id == 850001));

    // FOPS with contact
    let fops_req: CaseRequest = serde_json::from_value(json!({
        "projectName": "FOPS_Contact_Demo",
        "case": {
            "kind": "radioss-fops",
            "parameters": {
                "base": {
                    "name": "FOPS_CONTACT_1",
                    "runName": "FOPS_CT",
                    "solver": "radioss",
                    "solverVersion": "2022",
                    "units": {
                        "input": { "mass": "kg", "length": "mm", "time": "ms" },
                        "work": { "mass": "kg", "length": "mm", "time": "ms" },
                        "confirmedAgainstTargetModel": true
                    },
                    "references": {
                        "loadTarget": { "kind": "node", "nodeId": 3001 },
                        "constraints": [
                            { "target": { "kind": "nodes", "nodeIds": [4001, 4002] },
                              "dofs": [true, true, true, true, true, true] }
                        ]
                    },
                    "loading": {
                        "direction": "-Z",
                        "curve": [
                            { "time": 0.0, "value": 0.0 },
                            { "time": 0.01, "value": 30.0 },
                            { "time": 0.05, "value": 30.0 }
                        ]
                    },
                    "engine": {
                        "endTime": 0.05,
                        "animation": { "startTime": 0.0, "interval": 0.005 },
                        "timeHistoryInterval": 0.0005,
                        "timeStep": { "mode": "natural" }
                    },
                    "contacts": [contact_json],
                    "idPolicy": { "generatedStart": 800000, "manuallyOccupiedRanges": [] }
                },
                "impact": { "dropMassKg": 300.0, "dropHeightMm": 3000.0, "gravityG": 1.0 }
            }
        }
    }))
    .unwrap();
    let fp = preview_case(fops_req);
    assert!(fp.summary.can_export, "diagnostics: {:?}", fp.diagnostics);
    assert!(fp.fem_preview.contains("/INTER/TYPE7/850001"));
    assert_type7_columns(&fp.fem_preview);
    assert!(fp.fem_preview.contains("    810001         Z"));
    assert!(fp.fem_preview.contains("                 1.0                -1.0"));

    // Invalid Set ID = 0 must be rejected.
    let mut bad_ct = rops_request();
    if let loadcreator_app_lib::core::case_spec::CaseSpec::RadiossRops(ref mut s) = bad_ct.case {
        let mut ct: loadcreator_app_lib::core::radioss_spec::RadiossContact =
            serde_json::from_value(contact_json).unwrap();
        ct.master_surf_id = 0;
        s.contacts.push(ct);
    }
    let bad_p = preview_case(bad_ct);
    assert!(!bad_p.summary.can_export);
    assert!(bad_p.diagnostics.iter().any(|d| d.code == "LC-REF-001"));
}

fn assert_type7_columns(deck: &str) {
    let rows: Vec<_> = deck.lines().skip_while(|line| *line != "/INTER/TYPE7/850001")
        .skip(2).take_while(|line| !line.starts_with('/')).filter(|line| !line.starts_with('#'))
        .collect();
    assert_eq!(rows.iter().map(|row| row.len()).collect::<Vec<_>>(), [100, 90, 100, 100, 100, 100]);
    assert_eq!(&rows[0][50..60], "          ");
    assert_eq!(rows[0][60..].split_whitespace().collect::<Vec<_>>(), ["0", "2", "0", "0"]);
    assert_eq!(&rows[1][60..80], "                    ");
    assert_eq!(rows[1][80..90].trim().parse::<i32>().unwrap(), 0);
    assert_eq!(rows[4][0..10].trim(), "000");
    assert_eq!(&rows[4][10..30], "                    ");
    assert_eq!(rows[4][30..40].trim().parse::<i32>().unwrap(), 6);
    for range in [40..60, 60..80, 80..100] {
        assert_eq!(rows[4][range].trim(), "0.0");
    }
    assert_eq!(rows[5][40..50].trim().parse::<i32>().unwrap(), 2);
}

#[test]
fn type7_writes_optional_rows_in_radioss_order() {
    use loadcreator_app_lib::core::case_spec::CaseSpec;
    let mut req = rops_request();
    let CaseSpec::RadiossRops(ref mut spec) = req.case else { unreachable!() };
    spec.contacts.push(serde_json::from_value(json!({
        "slaveGrnodId": 101, "masterSurfId": 201, "ibag": 1000, "idel": -2, "iTied": 2,
        "icurv": 1, "curvNodeId1": 1001, "ifric": 2, "c6": 0.12, "ithe": 1
    })).unwrap());
    assert!(!preview_case(req.clone()).summary.can_export);
    let CaseSpec::RadiossRops(ref mut spec) = req.case else { unreachable!() };
    spec.contacts[0].thermal = Some(serde_json::from_value(json!({
        "coefficient": 2.5, "functionId": 32, "interfaceTemperature": 293.0,
        "formulation": 1, "pressureScale": 1.75, "radiationDistance": 0.25
    })).unwrap());
    let preview = preview_case(req);
    assert!(preview.summary.can_export, "{:?}", preview.diagnostics);
    let rows: Vec<_> = preview.fem_preview.lines().skip_while(|line| *line != "/INTER/TYPE7/850001")
        .skip(2).take_while(|line| !line.starts_with('/')).filter(|line| !line.starts_with('#'))
        .collect();
    assert_eq!(rows.iter().map(|row| row.len()).collect::<Vec<_>>(), [100, 90, 100, 20, 100, 100, 100, 100, 20, 90, 80]);
    assert_eq!(rows[0][60..100].split_whitespace().collect::<Vec<_>>(), ["2", "-2", "1", "0"]);
    assert_eq!(rows[1][80..].trim(), "2");
    assert_eq!(rows[3].split_whitespace().collect::<Vec<_>>(), ["1001", "0"]);
    assert_eq!(rows[8].trim(), "0.12");
    assert_eq!(&rows[9][30..40], "          ");
    assert_eq!(rows[9].split_whitespace().collect::<Vec<_>>(), ["2.5", "32", "293.0", "1", "1.75"]);
    assert_eq!(rows[10][20..40].trim(), "0.25");
}
