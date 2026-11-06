//! L1/L2 kernel tests: id planner, writer, PSD math, module generation and the
//! command surface. These run offline (no HyperMesh / OptiStruct) and only prove
//! `Generated` — never `ImportVerified` or `SolverVerified`.

use serde_json::json;

use loadcreator_app_lib::commands::case::{build_case, preview_case, CaseRequest};
use loadcreator_app_lib::core::ids::{IdAllocator, IdKind, IdPolicy};
use loadcreator_app_lib::core::psd;
use loadcreator_app_lib::solvers::optistruct::writer::fmt_real;

#[test]
fn id_allocator_is_deterministic_and_idempotent() {
    let mut a = IdAllocator::new(IdPolicy::ProjectManaged);
    let l1 = a.allocate(IdKind::Load, "case#load");
    let l2 = a.allocate(IdKind::Load, "case#load");
    assert_eq!(l1, l2);
    assert_eq!(l1, 300_001);

    let mut b = IdAllocator::new(IdPolicy::ProjectManaged);
    assert_eq!(b.allocate(IdKind::Load, "case#load"), 300_001);
    assert_eq!(b.allocate(IdKind::Load, "case#load2"), 300_002);
}

#[test]
fn id_allocator_detects_external_collision_and_skips() {
    let mut a = IdAllocator::new(IdPolicy::ProjectManaged);
    a.note_external(IdKind::Load, 300_001, Some("user load".into()));
    let id = a.allocate(IdKind::Load, "gen#load");
    assert_eq!(id, 300_002, "must skip externally reserved 300001");
    // Forcing a collision through manual range should be reported.
    let mut b = IdAllocator::new(IdPolicy::ManualRange {
        ranges: Default::default(),
    });
    b.note_external(IdKind::Spc, 900_001, Some("ext".into()));
    let sid = b.allocate(IdKind::Spc, "gen#spc");
    assert_eq!(sid, 900_002);
    assert!(b.conflicts().is_empty());
}

#[test]
fn float_formatting_is_strict() {
    assert_eq!(fmt_real(0.0).unwrap(), "0.0");
    assert_eq!(fmt_real(-0.0).unwrap(), "0.0");
    assert_eq!(fmt_real(-4150.0).unwrap(), "-4150.0");
    assert_eq!(fmt_real(0.15).unwrap(), "0.15");
    assert!(fmt_real(f64::NAN).is_err());
    assert!(fmt_real(f64::INFINITY).is_err());
}

#[test]
fn psd_constant_area_is_one_g() {
    let points = vec![(10.0, 0.01), (110.0, 0.01)];
    for mode in ["LINEAR-LINEAR", "LOG-LOG"] {
        let g = psd::grms(&points, mode).unwrap();
        assert!((g - 1.0).abs() < 1e-9, "{mode} => {g}");
    }
}

#[test]
fn psd_loglog_one_over_f_matches_analytic() {
    let points = vec![(1.0, 1.0), (10.0, 0.1)];
    let area = psd::integrate_psd(&points, "LOG-LOG").unwrap();
    let expected = (10.0f64).ln();
    assert!(
        (area - expected).abs() < 1e-9,
        "area {area} vs ln10 {expected}"
    );
}

#[test]
fn psd_validation_rejects_bad_tables() {
    assert!(!psd::validate_spectrum(&[(10.0, 0.01)], "LOG-LOG").is_empty());
    assert!(!psd::validate_spectrum(&[(10.0, 0.01), (10.0, 0.02)], "LOG-LOG").is_empty());
    assert!(!psd::validate_spectrum(&[(10.0, 0.01), (20.0, -1.0)], "LINEAR-LINEAR").is_empty());
    assert!(!psd::validate_spectrum(&[(10.0, 0.0), (20.0, 0.1)], "LOG-LOG").is_empty());
    assert!(psd::validate_spectrum(&[(10.0, 0.01), (20.0, 0.02)], "LOG-LOG").is_empty());
}

fn nodal_static_request() -> CaseRequest {
    serde_json::from_value(json!({
        "projectName": "Demo_Static",
        "case": {
            "kind": "nodal-static",
            "parameters": {
                "name": "Front_Load",
                "modelUnits": "N-mm-s",
                "loads": [
                    { "nodeId": 1001, "fx": 100.0, "fy": 0.0, "fz": -50.0, "label": "front" }
                ],
                "existingSpcSetId": 900001,
                "outputProfile": "STATIC_BASIC"
            }
        }
    }))
    .unwrap()
}

#[test]
fn nodal_static_builds_force_and_subcase() {
    let req = nodal_static_request();
    let preview = preview_case(req.clone());
    assert!(
        preview.summary.can_export,
        "diagnostics: {:?}",
        preview.diagnostics
    );
    assert!(preview.fem_preview.contains("SOL 101"));
    assert!(preview
        .fem_preview
        .contains("FORCE,300001,1001,0,1.0,100.0,0.0,-50.0"));
    assert!(preview.fem_preview.contains("SUBCASE 101"));
    assert!(preview.fem_preview.contains("SPC = 900001"));
    assert!(!preview.fem_preview.contains("GRID,"));
    assert!(preview
        .external_references
        .iter()
        .any(|r| r.status == "UNVERIFIED_EXTERNAL"));

    let build = build_case(req);
    assert!(build.files.contains_key("Demo_Static.fem"));
    assert!(build.files.contains_key("Demo_Static.manifest.json"));
}

#[test]
fn output_is_deterministic() {
    let a = build_case(nodal_static_request());
    let b = build_case(nodal_static_request());
    assert_eq!(a.files, b.files);
}

fn random_psd_request(confirm: bool) -> CaseRequest {
    serde_json::from_value(json!({
        "projectName": "Battery_PSD",
        "case": {
            "kind": "random-psd",
            "parameters": {
                "name": "Battery_PSD_Z",
                "modelUnits": "N-mm-s",
                "solverVersion": "2022",
                "excitation": {
                    "kind": "base-acceleration",
                    "nodeId": 1001,
                    "component": 3,
                    "existingSpcSetId": 9001,
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
                "frequency": { "minHz": 10.0, "maxHz": 200.0, "stepHz": 1.0 },
                "modal": { "minHz": 0.0, "maxHz": 300.0, "solver": "LANCZOS" },
                "damping": { "kind": "modal-critical-ratio", "ratio": 0.02 },
                "output": { "profile": "PSD_AND_RMS", "h3d": true, "stress": true, "displacement": true, "acceleration": true },
                "confirmExcitedDofInSpc": confirm
            }
        }
    }))
    .unwrap()
}

#[test]
fn random_psd_builds_full_solve_chain() {
    let req = random_psd_request(true);
    let preview = preview_case(req);
    assert!(
        preview.summary.can_export,
        "diagnostics: {:?}",
        preview.diagnostics
    );
    let fem = &preview.fem_preview;
    // MFREQ subcase 101, RANDOM subcase 102.
    assert!(fem.contains("SUBCASE 101"));
    assert!(fem.contains("SUBCASE 102"));
    assert!(fem.contains("ANALYSIS = MFREQ"));
    assert!(fem.contains("ANALYSIS = RANDOM"));
    assert!(fem.contains("RANDOM = 400101"));
    // RANDPS J = K = MFREQ subcase, Y = 0, TID = table.
    assert!(fem.contains("RANDPS,400101,101,101,1.0,0.0,400001"));
    assert!(fem.contains("TABRND1,400001"));
    assert!(fem.contains("EIGRL,500001"));
    assert!(fem.contains("FREQ1,500101"));
    assert!(fem.contains("TABDMP1,500201"));
    assert!(fem.contains("RLOAD2,310001,320001"));
    assert!(fem.contains("SPCD,320001,1001,3,9806.65"));
    // Output flag for PSD+RMS.
    assert!(fem.contains("STRESS(SORT1,PSDF)=ALL"));
}

#[test]
fn random_psd_requires_spc_confirmation() {
    let req = random_psd_request(false);
    let report = preview_case(req);
    assert!(!report.summary.can_export);
    assert!(report.diagnostics.iter().any(|d| d.code == "LC-REF-001"));
}

#[test]
fn random_psd_rejects_out_of_range_spectrum() {
    let mut req = random_psd_request(true);
    if let loadcreator_app_lib::core::case_spec::CaseSpec::RandomPsd(ref mut spec) = req.case {
        spec.frequency.max_hz = 400.0; // beyond spectrum 200 Hz
    }
    let report = preview_case(req);
    assert!(!report.summary.can_export);
    assert!(report.diagnostics.iter().any(|d| d.code == "LC-PSD-001"));
}

#[test]
fn unsupported_solver_version_is_rejected() {
    let mut req = nodal_static_request();
    if let loadcreator_app_lib::core::case_spec::CaseSpec::NodalStatic(ref mut spec) = req.case {
        spec.solver_version = "2019".into();
    }
    let report = preview_case(req);
    assert!(!report.summary.can_export);
    assert!(report.diagnostics.iter().any(|d| d.code == "LC-COMPAT-001"));
}

#[test]
fn gravity_uses_unit_aware_scale() {
    let req: CaseRequest = serde_json::from_value(json!({
        "projectName": "Grav",
        "case": {
            "kind": "gravity",
            "parameters": {
                "name": "Gravity_Z",
                "modelUnits": "N-mm-s",
                "magnitudeG": 1.0,
                "direction": [0.0, 0.0, -1.0],
                "existingSpcSetId": 900001
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
    // scale = 1 g * 9806.65 mm/s²
    assert!(preview
        .fem_preview
        .contains("GRAV,300001,0,9806.65,0.0,0.0,-1.0"));
}

#[test]
fn tabular_load_still_works_through_command() {
    let req: CaseRequest = serde_json::from_value(json!({
        "projectName": "Legacy",
        "case": {
            "kind": "tabular-load",
            "parameters": {
                "projectName": "Legacy",
                "rows": [
                    {
                        "sourceLine": 2, "caseName": "case1", "groupName": "g",
                        "pointName": "p1", "displayName": "点1",
                        "x": 1.0, "y": 2.0, "z": 3.0, "time": null,
                        "fx": 10.0, "fy": 0.0, "fz": 0.0, "tx": 0.0, "ty": 0.0, "tz": 0.0
                    }
                ]
            }
        }
    }))
    .unwrap();
    let build = build_case(req);
    assert!(build.files.contains_key("Legacy.fem"));
    let fem = build.files.get("Legacy.fem").unwrap();
    assert!(fem.contains("FORCE,100001,1001"));
    assert!(!fem.contains("GRID,"));
}
