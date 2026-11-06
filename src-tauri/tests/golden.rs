//! Golden-fixture regression for generated FEM decks (L2). Compares the
//! deterministic writer output byte-for-byte against committed fixtures.

use std::fs;

use serde_json::json;

use loadcreator_app_lib::commands::case::{build_case, CaseRequest};
use loadcreator_app_lib::core::diagnostics::Severity;

fn check(name: &str, req: CaseRequest) {
    let built = build_case(req);
    let errors: Vec<_> = built
        .diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .collect();
    assert!(errors.is_empty(), "{name} has errors: {errors:?}");
    let fem = built
        .files
        .iter()
        .find(|(k, _)| k.ends_with(".fem"))
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    assert!(!fem.is_empty(), "{name} produced no fem");
    let expected = fs::read_to_string(format!("fixtures/optistruct_2022/{name}/expected.fem"))
        .unwrap_or_else(|e| panic!("missing fixture {name}: {e}"));
    assert_eq!(fem, expected, "golden mismatch for {name}");
}

#[test]
fn nodal_static_golden() {
    check("nodal_static", serde_json::from_value(json!({"projectName":"nodal_static","case":{"kind":"nodal-static","parameters":{"name":"Front_Load","modelUnits":"N-mm-s","loads":[{"nodeId":1001,"fx":100.0,"fz":-50.0,"label":"front"}],"existingSpcSetId":900001}}})).unwrap());
}

#[test]
fn gravity_golden() {
    check("gravity", serde_json::from_value(json!({"projectName":"gravity","case":{"kind":"gravity","parameters":{"name":"Gravity_Z","modelUnits":"N-mm-s","magnitudeG":1.0,"direction":[0.0,0.0,-1.0],"existingSpcSetId":900001}}})).unwrap());
}

#[test]
fn random_psd_accel_z_golden() {
    check("random_psd_accel_z", serde_json::from_value(json!({"projectName":"random_psd_accel_z","case":{"kind":"random-psd","parameters":{"name":"Battery_PSD_Z","modelUnits":"N-mm-s","solverVersion":"2022","excitation":{"kind":"base-acceleration","nodeId":1001,"component":3,"existingSpcSetId":9001,"inputPsdUnit":"g^2/Hz","referenceAmplitudeG":1.0},"spectrum":{"interpolation":"LOG-LOG","outOfRange":"ERROR","points":[{"frequencyHz":10.0,"psd":0.003},{"frequencyHz":100.0,"psd":0.006},{"frequencyHz":200.0,"psd":0.003}]},"frequency":{"minHz":10.0,"maxHz":200.0,"stepHz":1.0},"modal":{"minHz":0.0,"maxHz":300.0,"solver":"LANCZOS"},"damping":{"kind":"modal-critical-ratio","ratio":0.02},"output":{"profile":"PSD_AND_RMS","h3d":true,"stress":true,"displacement":true,"acceleration":true},"confirmExcitedDofInSpc":true}}})).unwrap());
}
