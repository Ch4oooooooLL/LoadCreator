//! Radioss ROPS incremental-case specification (solver profile: Radioss 2022).
//!
//! This is deliberately a *separate* solver profile from OptiStruct: Radioss is
//! not an SOL 101 / SUBCASE / BEGIN BULK variant. The spec carries the three
//! unit dimensions explicitly (input vs work), user-declared external ids and the
//! engine controls needed for a single-stage Radioss single-file increment.
//!
//! v1 scope: ROPS controlled displacement only. FOPS modes are intentionally not
//! modelled here (SPEC 4.2); they require their own P0-F validation.

use serde::{Deserialize, Serialize};

fn default_radioss() -> String {
    "radioss".into()
}
fn default_version() -> String {
    "2022".into()
}
fn default_run_name() -> String {
    "ROPS_CASE".into()
}
fn default_mass() -> String {
    "kg".into()
}
fn default_length() -> String {
    "mm".into()
}
fn default_time() -> String {
    "ms".into()
}
fn default_gen_start() -> u64 {
    800_000
}

/// A single unit system: mass / length / time labels (e.g. kg / mm / ms).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitTriple {
    #[serde(default = "default_mass")]
    pub mass: String,
    #[serde(default = "default_length")]
    pub length: String,
    #[serde(default = "default_time")]
    pub time: String,
}

impl Default for UnitTriple {
    fn default() -> Self {
        Self {
            mass: default_mass(),
            length: default_length(),
            time: default_time(),
        }
    }
}

impl UnitTriple {
    pub fn as_array(&self) -> [String; 3] {
        [self.mass.clone(), self.length.clone(), self.time.clone()]
    }
}

/// Input vs work unit systems plus the mandatory "confirmed against target model"
/// acknowledgement (SPEC 3.3: the tool cannot read the base model).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RadiossUnits {
    #[serde(default)]
    pub input: UnitTriple,
    #[serde(default)]
    pub work: UnitTriple,
    #[serde(default)]
    pub confirmed_against_target_model: bool,
}

/// Load target: an existing node (program builds a single-node /GRNOD/NODE) or an
/// already-existing node group (/GRNOD).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum RadiossLoadTarget {
    Node { node_id: u64 },
    Grnod { grnod_id: u64 },
}

/// Constraint target: an existing node group or a list of node ids (program builds
/// a new /GRNOD/NODE).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum RadiossConstraintTarget {
    Nodes { node_ids: Vec<u64> },
    Grnod { grnod_id: u64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossConstraint {
    pub target: RadiossConstraintTarget,
    /// [TX, TY, TZ, RX, RY, RZ]; true = fixed DOF.
    #[serde(default)]
    pub dofs: [bool; 6],
    #[serde(default)]
    pub skew_id: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossCurvePoint {
    pub time: f64,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossLoading {
    /// "X" | "Y" | "Z"
    #[serde(default = "default_direction")]
    pub direction: String,
    #[serde(default)]
    pub curve: Vec<RadiossCurvePoint>,
    #[serde(default)]
    pub t_start: Option<f64>,
    #[serde(default)]
    pub t_stop: Option<f64>,
    /// Optional existing local Skew id for the imposed displacement (0 = global).
    #[serde(default)]
    pub skew_id: Option<u64>,
}
fn default_direction() -> String {
    "X".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossReferences {
    pub load_target: RadiossLoadTarget,
    #[serde(default)]
    pub constraints: Vec<RadiossConstraint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossAnimation {
    pub start_time: f64,
    pub interval: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum RadiossTimeStep {
    /// Let Radioss use its natural elementary time step (no extra card).
    Natural,
    /// Nodal time step control with added mass (/DT/NODA/CST).
    NodaCst { scale: f64, target: f64 },
    /// Advanced mass scaling (/AMS starter + /DT/AMS engine pair).
    Ams {
        scale: f64,
        target: f64,
        #[serde(default)]
        ams_part_group_id: Option<u64>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossEngine {
    pub end_time: f64,
    pub animation: RadiossAnimation,
    pub time_history_interval: f64,
    pub time_step: RadiossTimeStep,
}

/// Optional constant gravity (/GRAV). magnitude is a signed acceleration in the
/// work unit system; direction selects the axis.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossGravity {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub magnitude: f64,
    #[serde(default = "default_direction")]
    pub direction: String,
}

/// Deterministic generated-id policy. generated_start is the base; each entity
/// family gets a distinct offset so a node id is never reused as a group id.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossIdPolicy {
    #[serde(default = "default_gen_start")]
    pub generated_start: u64,
    #[serde(default)]
    pub manually_occupied_ranges: Vec<[u64; 2]>,
}

impl Default for RadiossIdPolicy {
    fn default() -> Self {
        Self {
            generated_start: default_gen_start(),
            manually_occupied_ranges: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossRopsSpec {
    /// Human/UI case name (may contain Chinese; never written into the .rad).
    pub name: String,
    #[serde(default = "default_run_name")]
    pub run_name: String,
    #[serde(default = "default_radioss")]
    pub solver: String,
    #[serde(default = "default_version")]
    pub solver_version: String,
    #[serde(default)]
    pub units: RadiossUnits,
    pub references: RadiossReferences,
    pub loading: RadiossLoading,
    pub engine: RadiossEngine,
    #[serde(default)]
    pub gravity: Option<RadiossGravity>,
    #[serde(default)]
    pub id_policy: RadiossIdPolicy,
}

/// FOPS drop-hammer impact parameters. These are *informational* for the
/// controlled-displacement approximation: they derive impact velocity / energy
/// diagnostics and never rewrite the generated deck.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossImpact {
    /// Drop-hammer mass in kg.
    #[serde(default)]
    pub drop_mass_kg: f64,
    /// Free-fall height in mm.
    #[serde(default)]
    pub drop_height_mm: f64,
    /// Gravity acceleration as a multiple of standard gravity (default 1).
    #[serde(default = "default_impact_gravity")]
    pub gravity_g: f64,
}
fn default_impact_gravity() -> f64 {
    1.0
}
impl Default for RadiossImpact {
    fn default() -> Self {
        Self {
            drop_mass_kg: 0.0,
            drop_height_mm: 0.0,
            gravity_g: 1.0,
        }
    }
}

/// FOPS drop-hammer impact case. It reuses the ROPS single-file increment engine
/// (imposed-displacement approximation) while carrying extra impact metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossFopsSpec {
    pub base: RadiossRopsSpec,
    #[serde(default)]
    pub impact: RadiossImpact,
}
