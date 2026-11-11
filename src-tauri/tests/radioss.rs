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
