//! Integration tests for Multi-Case OptiStruct 2022 FEM assembly & cross-case compatibility.

use serde_json::json;

use loadcreator_app_lib::commands::case::{build_case, preview_case, CaseRequest};

fn constraint_item(case_id: &str, name: &str, node_id: u64, dofs: Vec<u32>) -> serde_json::Value {
    json!({
        "caseId": case_id,
        "enabled": true,
        "spec": {
            "kind": "constraint",
            "parameters": {
                "name": name,
                "modelUnits": "N-mm-s",
                "mode": "new",
                "rows": [
                    { "nodeId": node_id, "dofs": dofs, "value": 0.0, "cid": 0 }
                ]
            }
        }
    })
}

fn nodal_static_item(
    case_id: &str,
    name: &str,
    spc_source: serde_json::Value,
    per_row: bool,
) -> serde_json::Value {
    json!({
        "caseId": case_id,
        "enabled": true,
        "spcSource": spc_source,
        "spec": {
            "kind": "nodal-static",
            "parameters": {
                "name": name,
                "modelUnits": "N-mm-s",
                "perRowSubcase": per_row,
                "loads": [
                    { "nodeId": 1001, "cid": 0, "fx": 120.0, "fy": 0.0, "fz": -500.0, "label": "Mount_A" }
                ]
            }
        }
    })
}

fn gravity_item(case_id: &str, name: &str, spc_source: serde_json::Value) -> serde_json::Value {
    json!({
        "caseId": case_id,
        "enabled": true,
        "spcSource": spc_source,
        "spec": {
            "kind": "gravity",
            "parameters": {
                "name": name,
                "modelUnits": "N-mm-s",
                "cases": [
                    { "name": "Grav_Z", "acceleration": 9806.65, "nx": 0.0, "ny": 0.0, "nz": -1.0, "cid": 0 }
                ]
            }
        }
    })
}

fn normal_modes_item(case_id: &str, name: &str, spc_source: serde_json::Value) -> serde_json::Value {
    json!({
        "caseId": case_id,
        "enabled": true,
        "spcSource": spc_source,
        "spec": {
            "kind": "normal-modes",
            "parameters": {
                "name": name,
                "modelUnits": "N-mm-s",
                "eigrlMinHz": 0.0,
                "eigrlMaxHz": 300.0,
                "numModes": 10
            }
        }
    })
}

fn freq_resp_item(
    case_id: &str,
    name: &str,
    spc_source: serde_json::Value,
    load_source: serde_json::Value,
) -> serde_json::Value {
    json!({
        "caseId": case_id,
        "enabled": true,
        "spcSource": spc_source,
        "loadSource": load_source,
        "spec": {
            "kind": "frequency-response",
            "parameters": {
                "name": name,
                "modelUnits": "N-mm-s",
                "existingSpcSetId": 900001,
                "frequencyMinHz": 10.0,
                "frequencyMaxHz": 200.0,
                "frequencyStepHz": 5.0,
                "eigrlMinHz": 0.0,
                "eigrlMaxHz": 300.0,
                "dampingRatio": 0.02
            }
        }
    })
}

fn random_psd_item(
    case_id: &str,
    name: &str,
    node_id: u64,
    component: u32,
    spc_source: serde_json::Value,
) -> serde_json::Value {
    json!({
        "caseId": case_id,
        "enabled": true,
        "spcSource": spc_source,
        "spec": {
            "kind": "random-psd",
            "parameters": {
                "name": name,
                "modelUnits": "N-mm-s",
                "solverVersion": "2022",
                "excitation": {
                    "kind": "base-acceleration",
                    "nodeId": node_id,
                    "component": component,
                    "existingSpcSetId": 900001,
                    "inputPsdUnit": "g^2/Hz",
                    "referenceAmplitudeG": 1.0
                },
                "spectrum": {
                    "interpolation": "LOG-LOG",
                    "outOfRange": "ERROR",
                    "points": [
                        { "frequencyHz": 10.0, "psd": 0.003 },
                        { "frequencyHz": 100.0, "psd": 0.006 },
                        { "frequencyHz": 200.0, "psd": 0.003 }
                    ]
                },
                "frequency": {
                    "minHz": 10.0,
                    "maxHz": 200.0,
                    "stepHz": 5.0,
                    "kind": "FREQ1"
                },
                "modal": {
                    "minHz": 0.0,
                    "maxHz": 300.0,
                    "solver": "LANCZOS"
                },
                "damping": { "kind": "modal-critical-ratio", "ratio": 0.02 },
                "confirmExcitedDofInSpc": true
            }
        }
    })
}

#[test]
fn multi_case_combines_all_optistruct_disciplines_with_linked_spc_and_load() {
    let req: CaseRequest = serde_json::from_value(json!({
        "projectName": "Combined_Vehicle",
        "case": {
            "kind": "multi-case",
            "parameters": {
                "name": "Combined_Vehicle",
                "modelUnits": "N-mm-s",
                "solver": "optistruct",
                "solverVersion": "2022",
                "cases": [
                    constraint_item("c-spc", "Base_Fix", 2001, vec![1, 2, 3]),
                    nodal_static_item("c-stat", "Front_Force", json!({ "kind": "case", "caseId": "c-spc" }), false),
                    gravity_item("c-grav", "Gravity_Loads", json!({ "kind": "case", "caseId": "c-spc" })),
                    normal_modes_item("c-mod", "Chassis_Modes", json!({ "kind": "case", "caseId": "c-spc" })),
                    freq_resp_item(
                        "c-freq",
                        "Sweep_Resp",
                        json!({ "kind": "case", "caseId": "c-spc" }),
                        json!({ "kind": "case", "caseId": "c-stat" })
                    ),
                    random_psd_item("c-psd", "Battery_PSD", 2001, 3, json!({ "kind": "case", "caseId": "c-spc" }))
                ]
            }
        }
    }))
    .unwrap();

    let preview = preview_case(req.clone());
    assert!(
        preview.summary.can_export,
        "diagnostics: {:?}",
        preview.diagnostics
    );
    assert_eq!(preview.summary.sol, Some(111));
    // 1 nodal static + 1 gravity + 1 normal modes + 1 freq resp + 2 random psd (MFREQ + RANDOM) = 6 subcases
    assert_eq!(preview.summary.subcase_count, 6);

    let fem = &preview.fem_preview;
    assert!(fem.contains("SOL 111"));
    assert!(fem.contains("SUBCASE 101"));
    assert!(fem.contains("SUBCASE 106"));
    assert!(fem.contains("ANALYSIS = STATICS"));
    assert!(fem.contains("ANALYSIS = MODES"));
    assert!(!fem.contains("ANALYSIS = MODAL"));
    assert!(fem.contains("ANALYSIS = MFREQ"));
    assert!(fem.contains("ANALYSIS = RANDOM"));
    assert!(fem.contains("SPC1,900001,123,2001"));
    assert!(fem.contains("EIGRL,500001,0.0,300.0,10"));
    assert!(fem.contains("SPC = 900001"));
    // Freq resp linked to Front_Force (300001) is wrapped in RLOAD2 + DLOAD and referenced via DLOAD =
    assert!(fem.contains("RLOAD2,310001,300001,,,,,LOAD"));
    assert!(fem.contains("DLOAD,300101,1.0,1.0,310001"));
    assert!(fem.contains("DLOAD = 300101"));
    // RANDPS J=K must point to the PSD's MFREQ subcase (105), not 101
    assert!(fem.contains("RANDPS,400101,105,105,1.0,0.0,400001"));
    assert!(!fem.contains("GRID,"));

    // Internal SPC 900001 must NOT appear as UNVERIFIED_EXTERNAL
    assert!(
        !preview
            .external_references
            .iter()
            .any(|r| r.kind == "spc" && r.id == 900001),
        "internal project SPC should not be flagged external"
    );

    // Deterministic output
    let a = build_case(req.clone());
    let b = build_case(req);
    assert_eq!(a.files, b.files);
    assert!(a.files.contains_key("Combined_Vehicle.fem"));
    assert!(a.files.contains_key("Combined_Vehicle.manifest.json"));
}

#[test]
fn multi_case_avoids_external_spc_id_collision_automatically() {
    let req: CaseRequest = serde_json::from_value(json!({
        "projectName": "Avoid_Collision",
        "case": {
            "kind": "multi-case",
            "parameters": {
                "name": "Avoid_Collision",
                "modelUnits": "N-mm-s",
                "cases": [
                    constraint_item("c-spc", "New_Fix", 2001, vec![1, 2, 3]),
                    nodal_static_item("c-stat", "Ext_Spc_Static", json!({ "kind": "external", "id": 900001 }), false)
                ]
            }
        }
    }))
    .unwrap();

    let preview = preview_case(req);
    assert!(
        preview.summary.can_export,
        "diagnostics: {:?}",
        preview.diagnostics
    );
    // Generated constraint should automatically skip externally reserved 900001 and receive 900002!
    assert!(preview.fem_preview.contains("SPC1,900002,123,2001"));
    assert!(preview.fem_preview.contains("SPC = 900001"));
}

#[test]
fn multi_case_rejects_mismatched_units_and_radioss_and_missing_psd_dof() {
    // 1. Unit mismatch
    let unit_req: CaseRequest = serde_json::from_value(json!({
        "projectName": "Unit_Mismatch",
        "case": {
            "kind": "multi-case",
            "parameters": {
                "name": "Unit_Mismatch",
                "modelUnits": "N-mm-s",
                "cases": [
                    {
                        "caseId": "c-1",
                        "enabled": true,
                        "spec": {
                            "kind": "normal-modes",
                            "parameters": {
                                "name": "Modes_Meters",
                                "modelUnits": "N-m-s",
                                "eigrlMinHz": 0.0,
                                "eigrlMaxHz": 200.0
                            }
                        }
                    }
                ]
            }
        }
    }))
    .unwrap();
    let p_unit = preview_case(unit_req);
    assert!(!p_unit.summary.can_export);
    assert!(p_unit.diagnostics.iter().any(|d| d.code == "LC-COMPAT-001"));

    // 2. Radioss mixed into OptiStruct multi-case
    let rad_req: CaseRequest = serde_json::from_value(json!({
        "projectName": "Rad_Reject",
        "case": {
            "kind": "multi-case",
            "parameters": {
                "name": "Rad_Reject",
                "modelUnits": "N-mm-s",
                "cases": [
                    {
                        "caseId": "c-rad",
                        "enabled": true,
                        "spec": {
                            "kind": "radioss-rops",
                            "parameters": {
                                "name": "ROPS_1",
                                "runName": "ROPS_1",
                                "units": {
                                    "input": { "mass": "kg", "length": "mm", "time": "ms" },
                                    "work": { "mass": "kg", "length": "mm", "time": "ms" },
                                    "confirmedAgainstTargetModel": true
                                },
                                "references": {
                                    "loadTarget": { "kind": "node", "nodeId": 1001 },
                                    "constraints": []
                                },
                                "loading": {
                                    "direction": "X",
                                    "curve": [{ "time": 0.0, "value": 0.0 }, { "time": 0.1, "value": 10.0 }]
                                },
                                "engine": {
                                    "endTime": 0.1,
                                    "animation": { "startTime": 0.0, "interval": 0.01 },
                                    "timeHistoryInterval": 0.001,
                                    "timeStep": { "mode": "natural" }
                                }
                            }
                        }
                    }
                ]
            }
        }
    }))
    .unwrap();
    let p_rad = preview_case(rad_req);
    assert!(!p_rad.summary.can_export);
    assert!(p_rad.diagnostics.iter().any(|d| d.code == "LC-COMPAT-002"));

    // 3. PSD excited DOF 3 not covered by referenced Constraint (only 1,2)
    let dof_req: CaseRequest = serde_json::from_value(json!({
        "projectName": "Psd_Dof_Mismatch",
        "case": {
            "kind": "multi-case",
            "parameters": {
                "name": "Psd_Dof_Mismatch",
                "modelUnits": "N-mm-s",
                "cases": [
                    constraint_item("c-spc", "Only_XY", 2001, vec![1, 2]),
                    random_psd_item("c-psd", "PSD_Z", 2001, 3, json!({ "kind": "case", "caseId": "c-spc" }))
                ]
            }
        }
    }))
    .unwrap();
    let p_dof = preview_case(dof_req);
    assert!(!p_dof.summary.can_export);
    assert!(p_dof.diagnostics.iter().any(|d| d.code == "LC-COMPAT-004"));

    // 4. Child case with a different solver name ("nastran") must be rejected
    let diff_solver_req: CaseRequest = serde_json::from_value(json!({
        "projectName": "Solver_Mismatch",
        "case": {
            "kind": "multi-case",
            "parameters": {
                "name": "Solver_Mismatch",
                "modelUnits": "N-mm-s",
                "solver": "optistruct",
                "solverVersion": "2022",
                "cases": [
                    {
                        "caseId": "c-other",
                        "enabled": true,
                        "spec": {
                            "kind": "nodal-static",
                            "parameters": {
                                "name": "Other_Solver_Static",
                                "modelUnits": "N-mm-s",
                                "solver": "nastran",
                                "solverVersion": "2022",
                                "loads": [{ "nodeId": 1001, "fz": -100.0 }]
                            }
                        }
                    }
                ]
            }
        }
    }))
    .unwrap();
    let p_solver = preview_case(diff_solver_req);
    assert!(!p_solver.summary.can_export);
    assert!(p_solver.diagnostics.iter().any(|d| d.code == "LC-COMPAT-002"));
}

#[test]
fn multi_case_supports_tabular_load_and_disambiguates_duplicate_names() {
    let req: CaseRequest = serde_json::from_value(json!({
        "projectName": "Tabular_Plus_Gravity",
        "case": {
            "kind": "multi-case",
            "parameters": {
                "name": "Tabular_Plus_Gravity",
                "modelUnits": "N-mm-s",
                "cases": [
                    constraint_item("c-spc", "Fix_Pts", 1001, vec![1, 2, 3]),
                    nodal_static_item("c-n1", "Dup_Name", json!({ "kind": "case", "caseId": "c-spc" }), false),
                    nodal_static_item("c-n2", "Dup_Name", json!({ "kind": "case", "caseId": "c-spc" }), false),
                    {
                        "caseId": "c-tab",
                        "enabled": true,
                        "spcSource": { "kind": "case", "caseId": "c-spc" },
                        "spec": {
                            "kind": "tabular-load",
                            "parameters": {
                                "projectName": "Vehicle_Loads",
                                "rows": [
                                    {
                                        "sourceLine": 3,
                                        "caseName": "制动0.8g",
                                        "groupName": "front",
                                        "pointName": "frontsusp_a",
                                        "displayName": "前悬架连接点",
                                        "x": 1550.0,
                                        "y": 0.0,
                                        "z": -210.0,
                                        "time": null,
                                        "fx": -385.0,
                                        "fy": -4150.0,
                                        "fz": 35600.0,
                                        "tx": 0.0,
                                        "ty": 0.0,
                                        "tz": 0.0
                                    }
                                ]
                            }
                        }
                    }
                ]
            }
        }
    }))
    .unwrap();

    let built = build_case(req);
    assert!(
        !built.diagnostics.iter().any(|d| d.severity == loadcreator_app_lib::core::diagnostics::Severity::Error),
        "diagnostics: {:?}",
        built.diagnostics
    );
    assert!(built
        .diagnostics
        .iter()
        .any(|d| d.code == "LC-COMPAT-005"));
    assert!(built.files.contains_key("Tabular_Plus_Gravity.fem"));
    assert!(built.files.contains_key("Tabular_Plus_Gravity.manifest.json"));
    assert!(built.files.contains_key("Tabular_Plus_Gravity_points.json"));

    let fem = &built.files["Tabular_Plus_Gravity.fem"];
    assert!(fem.contains("Dup_Name_2"));
    assert!(fem.contains("LS_001_Braking_0.8g"));
    assert!(fem.contains("FORCE,300003,1001,0,1.0,-385.0,-4150.0,35600.0"));
}
