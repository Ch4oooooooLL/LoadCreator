//! L1/L2 tests for the OptiStruct advanced random-vibration cards added in
//! milestone M2: EIGRA, RLOAD1, TABLED1, FREQ2/FREQ and sequential tri-axis.
//!
//! These prove generated text only (never HyperMesh import / OptiStruct solve).

use serde_json::json;

use loadcreator_app_lib::commands::case::{build_case, preview_case, CaseRequest};
use loadcreator_app_lib::core::cards::{BulkCard, RealOrRef, TableOrConst};
use loadcreator_app_lib::core::deck_ir::{DeckFragment, Subcase};
use loadcreator_app_lib::solvers::optistruct::writer::{write_fem, WriteInput, WriterOptions};

fn base(extra: serde_json::Value) -> CaseRequest {
    let mut params = json!({
        "name": "Adv_PSD",
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
        "confirmExcitedDofInSpc": true
    });
    for (k, v) in extra.as_object().unwrap() {
        params[k] = v.clone();
    }
    serde_json::from_value(json!({
        "projectName": "Adv_PSD",
        "case": { "kind": "random-psd", "parameters": params }
    }))
    .unwrap()
}

#[test]
fn eigra_modal_method_emits_eigra_card() {
    let req = base(json!({
        "modal": { "minHz": 0.0, "maxHz": 300.0, "solver": "AMSES" },
        "eigra": { "v2Hz": 300.0, "msglvl": 1, "ampffact": 10.0, "norm": "MAX" }
    }));
    let p = preview_case(req);
    assert!(p.summary.can_export, "diagnostics: {:?}", p.diagnostics);
    assert!(p.fem_preview.contains("EIGRA,500001,0.0,300.0,,1,10.0,,MAX"), "got:\n{}", p.fem_preview);
    assert!(!p.fem_preview.contains("EIGRL,500001"));
}

#[test]
fn eigra_requires_v2() {
    let req = base(json!({ "modal": { "minHz": 0.0, "maxHz": 300.0, "solver": "AMSES" } }));
    let p = preview_case(req);
    assert!(!p.summary.can_export);
    assert!(p.diagnostics.iter().any(|d| d.code == "LC-PSD-020"));
}

#[test]
fn rload1_excitation_emits_complex_card() {
    let req = base(json!({ "excitationForm": "RLOAD1" }));
    let p = preview_case(req);
    assert!(p.summary.can_export, "diagnostics: {:?}", p.diagnostics);
    assert!(p.fem_preview.contains("RLOAD1,310001,320001,,,1.0,0.0,ACCE"), "got:\n{}", p.fem_preview);
    assert!(!p.fem_preview.contains("RLOAD2,"));
}

#[test]
fn freq2_log_distribution_emits_freq2() {
    let req = base(json!({ "frequency": { "minHz": 10.0, "maxHz": 200.0, "kind": "FREQ2", "nf": 3 } }));
    let p = preview_case(req);
    assert!(p.summary.can_export, "diagnostics: {:?}", p.diagnostics);
    assert!(p.fem_preview.contains("FREQ2,500101,10.0,200.0,3"), "got:\n{}", p.fem_preview);
}

#[test]
fn freq_list_emits_discrete_freq() {
    let req = base(json!({ "frequency": { "minHz": 10.0, "maxHz": 200.0, "kind": "FREQ", "explicitHz": [10.0, 50.0, 100.0] } }));
    let p = preview_case(req);
    assert!(p.summary.can_export, "diagnostics: {:?}", p.diagnostics);
    assert!(p.fem_preview.contains("FREQ,500101,10.0,50.0,100.0"), "got:\n{}", p.fem_preview);
}

#[test]
fn sequential_tri_generates_six_subcases() {
    let req = base(json!({ "axisMode": "sequential-tri" }));
    let p = preview_case(req.clone());
    assert!(p.summary.can_export, "diagnostics: {:?}", p.diagnostics);
    let fem = &p.fem_preview;
    assert_eq!(fem.matches("SUBCASE ").count(), 6, "want 6 subcases");
    assert_eq!(fem.matches("ANALYSIS = MFREQ").count(), 3);
    assert_eq!(fem.matches("ANALYSIS = RANDOM").count(), 3);
    // Three SPCD (components 1/2/3) + three independent RANDPS.
    assert_eq!(fem.matches("SPCD,").count(), 3);
    assert_eq!(fem.matches("RANDPS,").count(), 3);
    // Each RANDPS self-spectrum references its own MFREQ subcase (J=K).
    assert!(fem.contains("RANDPS,400101,101,101,"), "got:\n{fem}");
    assert!(fem.contains("RANDPS,400102,103,103,"));
    assert!(fem.contains("RANDPS,400103,105,105,"));
    let build = build_case(req);
    assert!(build.id_plan.iter().any(|a| a.kind == "subcase" && a.id == 106));
}

#[test]
fn sequential_tri_rejects_applied_force() {
    let req = base(json!({
        "axisMode": "sequential-tri",
        "excitation": {
            "kind": "applied-force",
            "nodeId": 1001,
            "direction": [0.0, 0.0, 1.0],
            "existingSpcSetId": 9001,
            "inputPsdUnit": "N^2/Hz",
            "referenceForceN": 1.0
        }
    }));
    let p = preview_case(req);
    assert!(!p.summary.can_export);
    assert!(p.diagnostics.iter().any(|d| d.code == "LC-PSD-020"));
}

#[test]
fn tabled1_and_rload1_with_refs_and_tables_serialize() {
    let mut frag = DeckFragment::new(111);
    frag.subcases.push(Subcase {
        id: 101,
        label: "M".into(),
        analysis: Some("MFREQ".into()),
        ..Default::default()
    });
    frag.bulk_cards.push(BulkCard::Tabled1 {
        tid: 600001,
        xaxis: "LINEAR".into(),
        yaxis: "SMOOTH".into(),
        flat: true,
        pairs: vec![(1.0, 1.0), (10.0, 0.5)],
    });
    frag.bulk_cards.push(BulkCard::Rload1 {
        sid: 310001,
        exciteid: 320001,
        delay: Some(RealOrRef::Ref(7)),
        dphase: Some(RealOrRef::Real(90.0)),
        tc: TableOrConst::Table(600001),
        td: TableOrConst::Constant(0.0),
        rtype: "ACCE".into(),
    });
    let text = write_fem(
        &WriteInput {
            title: "T",
            solver: "optistruct",
            solver_version: "2022",
            fragment: &frag,
        },
        &WriterOptions::default(),
    )
    .expect("write");
    assert!(text.contains("TABLED1,600001,LINEAR,SMOOTH,FLAT,1.0,1.0,10.0,0.5"), "got:\n{text}");
    // DELAY renders as integer card ref, DPHASE as real, TC as table ref.
    assert!(text.contains("RLOAD1,310001,320001,7,90.0,600001,0.0,ACCE"), "got:\n{text}");
}
