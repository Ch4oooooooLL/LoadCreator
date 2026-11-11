//! Typed case specifications. The frontend sends `{ "kind": ..., "parameters": {...} }`
//! and serde dispatches to the matching struct — no ad-hoc module guessing and
//! no module-defined card text ever reaches the writer.

use serde::{Deserialize, Serialize};

use crate::core::ids::IdPolicy;
use crate::core::radioss_spec::{RadiossFopsSpec, RadiossRopsSpec};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "parameters", rename_all = "kebab-case")]
pub enum CaseSpec {
    /// Legacy Excel/WPS tabular load (handled by the preserved pipeline).
    TabularLoad(TabularLoadSpec),
    NodalStatic(NodalStaticSpec),
    Constraint(ConstraintSpec),
    Gravity(GravitySpec),
    NormalModes(NormalModesSpec),
    FrequencyResponse(FrequencyResponseSpec),
    RandomPsd(RandomPsdSpec),
    /// Radioss 2022 single-file ROPS increment (separate solver profile).
    RadiossRops(RadiossRopsSpec),
    /// Radioss 2022 single-file FOPS drop-hammer increment (controlled-displacement approximation).
    RadiossFops(RadiossFopsSpec),
}

impl CaseSpec {
    pub fn kind(&self) -> &'static str {
        match self {
            CaseSpec::TabularLoad(_) => "tabular-load",
            CaseSpec::NodalStatic(_) => "nodal-static",
            CaseSpec::Constraint(_) => "constraint",
            CaseSpec::Gravity(_) => "gravity",
            CaseSpec::NormalModes(_) => "normal-modes",
            CaseSpec::FrequencyResponse(_) => "frequency-response",
            CaseSpec::RandomPsd(_) => "random-psd",
            CaseSpec::RadiossRops(_) => "radioss-rops",
            CaseSpec::RadiossFops(_) => "radioss-fops",
        }
    }
}

fn default_units() -> String {
    "N-mm-s".into()
}
fn default_optistruct() -> String {
    "optistruct".into()
}
fn default_version() -> String {
    "2022".into()
}
fn default_policy() -> IdPolicy {
    IdPolicy::ProjectManaged
}
fn default_profile() -> String {
    "STATIC_BASIC".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabularLoadSpec {
    #[serde(default)]
    pub project_name: String,
    #[serde(default)]
    pub rows: Vec<crate::load_deck::LoadRow>,
    #[serde(default)]
    pub case_aliases: std::collections::BTreeMap<String, String>,
    #[serde(default = "crate::core::case_spec::default_tolerance")]
    pub coordinate_tolerance: f64,
}
pub fn default_tolerance() -> f64 {
    1e-6
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodalLoadRow {
    pub node_id: u64,
    #[serde(default)]
    pub cid: u64,
    #[serde(default)]
    pub fx: f64,
    #[serde(default)]
    pub fy: f64,
    #[serde(default)]
    pub fz: f64,
    #[serde(default)]
    pub mx: f64,
    #[serde(default)]
    pub my: f64,
    #[serde(default)]
    pub mz: f64,
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodalStaticSpec {
    pub name: String,
    #[serde(default = "default_units")]
    pub model_units: String,
    #[serde(default = "default_optistruct")]
    pub solver: String,
    #[serde(default = "default_version")]
    pub solver_version: String,
    pub loads: Vec<NodalLoadRow>,
    #[serde(default)]
    pub existing_spc_set_id: Option<u64>,
    #[serde(default)]
    pub per_row_subcase: bool,
    #[serde(default = "default_profile")]
    pub output_profile: String,
    #[serde(default = "default_policy")]
    pub id_policy: IdPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintRow {
    pub node_id: u64,
    pub dofs: Vec<u32>,
    /// Forced displacement value in model units (0 / absent = homogeneous SPC).
    #[serde(default)]
    pub value: Option<f64>,
    #[serde(default)]
    pub cid: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintSpec {
    pub name: String,
    #[serde(default = "default_units")]
    pub model_units: String,
    #[serde(default = "default_optistruct")]
    pub solver: String,
    #[serde(default = "default_version")]
    pub solver_version: String,
    /// "new" (create SPC/SPC1) or "reference" (only reference existing sets).
    #[serde(default = "default_constraint_mode")]
    pub mode: String,
    #[serde(default)]
    pub rows: Vec<ConstraintRow>,
    /// External SPC set ids to reference or combine with.
    #[serde(default)]
    pub existing_spc_set_ids: Vec<u64>,
    /// Combine generated SPC with existing sets via SPCADD.
    #[serde(default)]
    pub combine_with_existing: bool,
    #[serde(default = "default_policy")]
    pub id_policy: IdPolicy,
}
pub fn default_constraint_mode() -> String {
    "new".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GravitySpec {
    pub name: String,
    #[serde(default = "default_units")]
    pub model_units: String,
    #[serde(default = "default_optistruct")]
    pub solver: String,
    #[serde(default = "default_version")]
    pub solver_version: String,
    /// Gravity magnitude expressed in multiples of standard gravity.
    pub magnitude_g: f64,
    /// Direction vector (normalised; magnitude ignored).
    #[serde(default)]
    pub direction: [f64; 3],
    #[serde(default)]
    pub cid: u64,
    #[serde(default)]
    pub existing_spc_set_id: Option<u64>,
    #[serde(default = "default_profile")]
    pub output_profile: String,
    #[serde(default = "default_policy")]
    pub id_policy: IdPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalModesSpec {
    pub name: String,
    #[serde(default = "default_units")]
    pub model_units: String,
    #[serde(default = "default_optistruct")]
    pub solver: String,
    #[serde(default = "default_version")]
    pub solver_version: String,
    #[serde(default)]
    pub existing_spc_set_id: Option<u64>,
    #[serde(default)]
    pub eigrl_min_hz: Option<f64>,
    #[serde(default)]
    pub eigrl_max_hz: Option<f64>,
    #[serde(default)]
    pub num_modes: Option<u64>,
    #[serde(default)]
    pub method_solver: Option<String>,
    #[serde(default = "default_modal_profile")]
    pub output_profile: String,
    #[serde(default = "default_policy")]
    pub id_policy: IdPolicy,
}
pub fn default_modal_profile() -> String {
    "MODAL_BASIC".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrequencyResponseSpec {
    pub name: String,
    #[serde(default = "default_units")]
    pub model_units: String,
    #[serde(default = "default_optistruct")]
    pub solver: String,
    #[serde(default = "default_version")]
    pub solver_version: String,
    pub existing_spc_set_id: u64,
    pub frequency_min_hz: f64,
    pub frequency_max_hz: f64,
    pub frequency_step_hz: f64,
    pub eigrl_min_hz: f64,
    pub eigrl_max_hz: f64,
    #[serde(default)]
    pub damping_ratio: f64,
    #[serde(default)]
    pub load_id: Option<u64>,
    #[serde(default = "default_policy")]
    pub id_policy: IdPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum Excitation {
    /// Base/acceleration PSD via SPCD + RLOAD2 TYPE=ACCE.
    BaseAcceleration {
        node_id: u64,
        /// 1/2/3 = X/Y/Z translation DOF.
        component: u32,
        existing_spc_set_id: u64,
        #[serde(default = "default_psd_unit")]
        input_psd_unit: String,
        /// Reference acceleration magnitude in g (default 1 g).
        #[serde(default = "default_ref_g")]
        reference_amplitude_g: f64,
    },
    /// Random nodal force PSD via DAREA + RLOAD2 TYPE=LOAD.
    AppliedForce {
        node_id: u64,
        #[serde(default)]
        cid: u64,
        direction: [f64; 3],
        existing_spc_set_id: u64,
        #[serde(default = "default_force_unit")]
        input_psd_unit: String,
        #[serde(default = "default_ref_force")]
        reference_force_n: f64,
    },
}
pub fn default_psd_unit() -> String {
    "g^2/Hz".into()
}
pub fn default_force_unit() -> String {
    "N^2/Hz".into()
}
pub fn default_ref_g() -> f64 {
    1.0
}
pub fn default_ref_force() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsdPoint {
    pub frequency_hz: f64,
    pub psd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsdSpectrum {
    /// "LOG-LOG" | "LINEAR-LINEAR" | "LOG-LINEAR" | "LINEAR-LOG"
    #[serde(default = "default_interp")]
    pub interpolation: String,
    /// "ERROR" | "FLAT" (default ERROR: out-of-range rejected by the tool).
    #[serde(default = "default_out_of_range")]
    pub out_of_range: String,
    pub points: Vec<PsdPoint>,
}
pub fn default_interp() -> String {
    "LOG-LOG".into()
}
pub fn default_out_of_range() -> String {
    "ERROR".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrequencyRange {
    pub min_hz: f64,
    pub max_hz: f64,
    /// FREQ1 increment (only used when kind == FREQ1).
    #[serde(default)]
    pub step_hz: f64,
    /// "FREQ1" (default, uniform step) | "FREQ2" (logarithmic) | "FREQ" (explicit list)
    #[serde(default = "default_freq_kind")]
    pub kind: String,
    /// FREQ2 interval count (NF). Required when kind == FREQ2.
    #[serde(default)]
    pub nf: Option<u64>,
    /// Explicit frequency list (Hz). Used when kind == FREQ.
    #[serde(default)]
    pub explicit_hz: Vec<f64>,
}
pub fn default_freq_kind() -> String {
    "FREQ1".into()
}

/// AMSES (EIGRA) advanced extraction settings (SPEC A5.1).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EigraOptions {
    /// Lowest frequency of interest (V1); default 0 when omitted.
    #[serde(default)]
    pub v1_hz: Option<f64>,
    /// Highest modal frequency (V2, mandatory for EIGRA).
    pub v2_hz: f64,
    /// Desired number of roots (ND); empty = full range.
    #[serde(default)]
    pub nd: Option<u64>,
    /// 0/1 AMSES diagnostic printing.
    #[serde(default)]
    pub msglvl: Option<u32>,
    /// Internal substructure frequency expansion factor (AMPFFACT).
    #[serde(default)]
    pub ampffact: Option<f64>,
    /// Normalisation: MASS (default) / MAX / ALL.
    #[serde(default)]
    pub norm: Option<String>,
}

pub fn default_axis_mode() -> String {
    "single".into()
}
pub fn default_excitation_form() -> String {
    "RLOAD2".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModalRange {
    pub min_hz: f64,
    pub max_hz: f64,
    #[serde(default = "default_lanczos")]
    pub solver: String,
}
pub fn default_lanczos() -> String {
    "LANCZOS".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Damping {
    ModalCriticalRatio { ratio: f64 },
}
impl Default for Damping {
    fn default() -> Self {
        Damping::ModalCriticalRatio { ratio: 0.02 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsdOutput {
    #[serde(default = "default_psd_profile")]
    pub profile: String,
    #[serde(default)]
    pub h3d: bool,
    #[serde(default)]
    pub stress: bool,
    #[serde(default)]
    pub displacement: bool,
    #[serde(default)]
    pub acceleration: bool,
}
pub fn default_psd_profile() -> String {
    "PSD_AND_RMS".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RandomPsdSpec {
    pub name: String,
    #[serde(default = "default_units")]
    pub model_units: String,
    #[serde(default = "default_optistruct")]
    pub solver: String,
    #[serde(default = "default_version")]
    pub solver_version: String,
    pub excitation: Excitation,
    pub spectrum: PsdSpectrum,
    pub frequency: FrequencyRange,
    pub modal: ModalRange,
    /// "single" (default) | "sequential-tri" (three independent MFREQ+RANDOM pairs).
    #[serde(default = "default_axis_mode")]
    pub axis_mode: String,
    /// "RLOAD2" (default, amplitude/phase) | "RLOAD1" (complex real/imag).
    #[serde(default = "default_excitation_form")]
    pub excitation_form: String,
    /// Extra AMSES settings; required when modal.solver selects EIGRA/AMSES.
    #[serde(default)]
    pub eigra: Option<EigraOptions>,
    #[serde(default)]
    pub damping: Damping,
    #[serde(default)]
    pub output: Option<PsdOutput>,
    /// User confirmation that the excited DOF is contained in the SPC set.
    #[serde(default)]
    pub confirm_excited_dof_in_spc: bool,
    #[serde(default = "default_policy")]
    pub id_policy: IdPolicy,
}

impl RandomPsdSpec {
    pub fn output(&self) -> PsdOutput {
        self.output.clone().unwrap_or(PsdOutput {
            profile: default_psd_profile(),
            h3d: true,
            stress: true,
            displacement: true,
            acceleration: true,
        })
    }
}

impl CaseSpec {
    /// Human-friendly case name used for output file stems / titles.
    pub fn display_name(&self) -> String {
        match self {
            CaseSpec::TabularLoad(s) => {
                if s.project_name.is_empty() {
                    "tabular_load".into()
                } else {
                    s.project_name.clone()
                }
            }
            CaseSpec::NodalStatic(s) => s.name.clone(),
            CaseSpec::Constraint(s) => s.name.clone(),
            CaseSpec::Gravity(s) => s.name.clone(),
            CaseSpec::NormalModes(s) => s.name.clone(),
            CaseSpec::FrequencyResponse(s) => s.name.clone(),
            CaseSpec::RandomPsd(s) => s.name.clone(),
            CaseSpec::RadiossRops(s) => s.name.clone(),
            CaseSpec::RadiossFops(s) => s.base.name.clone(),
        }
    }
}
