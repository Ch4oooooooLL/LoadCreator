//! Unit-system handling. OptiStruct itself has no fixed unit system, so the
//! generator must carry an explicit, consistent one and convert physical
//! reference values (notably the "g" used for base acceleration) explicitly.

use serde::{Deserialize, Serialize};

/// Standard gravity in m/s².
pub const STANDARD_GRAVITY: f64 = 9.806_65;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnitSystem {
    /// N, mm, s, tonne  →  acceleration in mm/s² (1 g ≈ 9806.65 mm/s²)
    NmmS,
    /// N, m, s, kg      →  acceleration in m/s²   (1 g ≈ 9.80665 m/s²)
    Nms,
}

impl UnitSystem {
    pub fn parse(text: &str) -> Option<Self> {
        let key: String = text
            .trim()
            .to_ascii_lowercase()
            .chars()
            .filter(|c| !matches!(c, ' ' | '_' | '/'))
            .collect();
        match key.as_str() {
            "n-mm-s" | "nmm-s" | "n-mms" => Some(Self::NmmS),
            "n-m-s" | "nm-s" | "n-ms" => Some(Self::Nms),
            _ => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::NmmS => "N-mm-s",
            Self::Nms => "N-m-s",
        }
    }

    /// Acceleration value that represents 1 g in this unit system.
    pub fn gravity(self) -> f64 {
        match self {
            Self::NmmS => STANDARD_GRAVITY * 1000.0,
            Self::Nms => STANDARD_GRAVITY,
        }
    }
}

/// Convenience for callers that carry a unit string without a parsed enum.
pub fn gravity_for(units: &str) -> Option<f64> {
    UnitSystem::parse(units).map(|u| u.gravity())
}
