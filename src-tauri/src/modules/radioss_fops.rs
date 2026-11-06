//! Radioss FOPS (falling-object protective structure) drop-hammer impact case.
//!
//! Implemented as a *controlled-displacement approximation*: the impact point
//! receives a vertical imposed-displacement curve that stands in for the drop
//! hammer stroke. This reuses the proven ROPS single-file increment engine
//! (/GRNOD/NODE, /FUNCT, /IMPDISP, /BCS, Engine controls) so the emitted deck
//! stays within the already-serialised keyword set.
//!
//! Deliberately NOT modelled in v1: an actual hammer solid, /INTER/TYPE7,
//! /RBODY, or multi-stage restart — those need their own P0 validation. Every
//! external node / group / skew / part-group is recorded as UNVERIFIED_EXTERNAL
//! by the shared ROPS generator.

use crate::core::diagnostics::Diagnostic;
use crate::core::radioss_deck::RadiossBuilt;
use crate::core::radioss_spec::RadiossFopsSpec;
use crate::modules::radioss_rops;

/// Standard gravity in m/s^2.
const G0: f64 = 9.806_65;

pub fn generate(spec: &RadiossFopsSpec) -> RadiossBuilt {
    // Reuse the ROPS controlled-displacement engine.
    let mut built = radioss_rops::generate(&spec.base);

    let imp = &spec.impact;
    let mut extra: Vec<Diagnostic> = Vec::new();

    let mass = imp.drop_mass_kg;
    let height_m = imp.drop_height_mm / 1000.0;
    let g_mul = imp.gravity_g;

    if !mass.is_finite() || mass <= 0.0 {
        extra.push(
            Diagnostic::error("LC-FOPS-001", "落锤质量必须为正的有限值（kg）")
                .field("impact.dropMassKg"),
        );
    }
    if !height_m.is_finite() || height_m <= 0.0 {
        extra.push(
            Diagnostic::error("LC-FOPS-001", "落差必须为正的有限值（mm）")
                .field("impact.dropHeightMm"),
        );
    }
    if !g_mul.is_finite() || g_mul <= 0.0 {
        extra.push(
            Diagnostic::error("LC-FOPS-001", "重力倍数必须为正的有限值").field("impact.gravityG"),
        );
    }

    if mass.is_finite() && mass > 0.0 && height_m.is_finite() && height_m > 0.0 && g_mul.is_finite() && g_mul > 0.0 {
        let g = G0 * g_mul;
        let v0 = (2.0 * g * height_m).sqrt();
        let energy = mass * g * height_m;
        extra.push(Diagnostic::info(
            "LC-FOPS-002",
            format!(
                "落锤冲击估算：v0 ≈ {:.2} m/s，冲击能量 ≈ {:.0} J（按落锤 {:.0} kg × 落差 {:.0} mm × {:.2} g 换算，仅工程校核，不写入 deck）",
                v0, energy, mass, imp.drop_height_mm, g_mul
            ),
        ));
    }

    built.diagnostics.extend(extra);
    built
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::radioss_spec::RadiossFopsSpec;

    #[test]
    fn fops_spec_deserializes_and_generates() {
        // Mirrors the exact payload shape the Workbench sends for kind=radioss-fops.
        let json = r#"{
            "base": {
            "name": "FOPS_CASE_1",
            "runName": "FOPS_CASE",
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
                      "dofs": [true, true, true, true, true, true], "skewId": null }
                ]
            },
            "loading": {
                "direction": "Z",
                "curve": [ { "time": 0.0, "value": 0.0 }, { "time": 0.01, "value": 30.0 }, { "time": 0.05, "value": 30.0 } ],
                "tStart": null, "tStop": null, "skewId": null
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
        }"#;

        let spec: RadiossFopsSpec = serde_json::from_str(json).expect("FOPS spec should deserialize");
        assert_eq!(spec.base.name, "FOPS_CASE_1");
        assert_eq!(spec.base.run_name, "FOPS_CASE");
        assert_eq!(spec.impact.drop_mass_kg, 300.0);
        assert_eq!(spec.impact.drop_height_mm, 3000.0);

        let built = generate(&spec);
        let errors: Vec<_> = built.diagnostics.iter().filter(|d| d.is_error()).collect();
        assert!(errors.is_empty(), "unexpected errors: {errors:?}");
        assert!(built.card_counts.contains_key("/IMPDISP"));
        assert!(built.diagnostics.iter().any(|d| d.code == "LC-FOPS-002"));
    }
}

