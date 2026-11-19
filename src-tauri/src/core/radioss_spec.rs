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

fn default_direction() -> String {
    "X".into()
}
fn default_direction_mode() -> String {
    "axis".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossLoading {
    /// "axis" (standard +/- X,Y,Z,XX,YY,ZZ) or "vector" (custom 3D vector via /SKEW/FIX).
    #[serde(default = "default_direction_mode")]
    pub direction_mode: String,
    /// "X" | "+X" | "-X" | "Y" | "+Y" | "-Y" | "Z" | "+Z" | "-Z" | "XX" | ...
    #[serde(default = "default_direction")]
    pub direction: String,
    /// Custom 3D direction vector [dx, dy, dz] when direction_mode == "vector".
    #[serde(default)]
    pub direction_vector: Option<[f64; 3]>,
    /// Optional origin [ox, oy, oz] for generated /SKEW/FIX (defaults to [0, 0, 0]).
    #[serde(default)]
    pub vector_origin: Option<[f64; 3]>,
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RadiossEngineControl {
    /// ENG_VERS: emit `/VERS/<version_num>`
    #[serde(default)]
    pub emit_vers: bool,
    #[serde(default = "default_vers_num")]
    pub version_num: u32,
    /// ENG_PARITH: None = omit, Some(true) = `/PARITH/ON`, Some(false) = `/PARITH/OFF`
    #[serde(default)]
    pub parith: Option<bool>,
    /// ENG_PRINT: emit `/PRINT/<n_print>[/<n_line>]`
    #[serde(default)]
    pub emit_print: bool,
    #[serde(default = "default_n_print")]
    pub n_print: i32,
    #[serde(default)]
    pub n_line: i32,
    /// ENG_TFILE Type: None or Some(0) = built-in format (`/TFILE`), 1..=4 = `/TFILE/<type>`
    #[serde(default)]
    pub tfile_type: Option<u32>,
    /// When false, omit `/TFILE`; absence retains the default T-file output.
    #[serde(default)]
    pub emit_tfile: Option<bool>,
    /// Time-history post-processing schema (`/TH/VERS`), independent of TFILE encoding.
    #[serde(default)]
    pub th_version: Option<u32>,
    /// ENG_ANIM_ELEM result keywords (e.g. "EPSP", "ENERGY", "VONM", "PRES", "HOURG", ...)
    #[serde(default)]
    pub anim_elem: Vec<String>,
    /// ENG_ANIM_NODA result keywords (e.g. "DMAS", "DT", ...)
    #[serde(default)]
    pub anim_noda: Vec<String>,
    /// ENG_ANIM_VECT result keywords (e.g. "ACC", "CONT", "DISP", ...)
    #[serde(default)]
    pub anim_vect: Vec<String>,
}

fn default_vers_num() -> u32 {
    2022
}
fn default_n_print() -> i32 {
    -1000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossEngine {
    pub end_time: f64,
    pub animation: RadiossAnimation,
    pub time_history_interval: f64,
    pub time_step: RadiossTimeStep,
    #[serde(default)]
    pub control: Option<RadiossEngineControl>,
}

fn default_grav_mode() -> String {
    "constant".into()
}

/// Gravity load (/GRAV), supporting constant acceleration or time-varying curve (/FUNCT).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossGravity {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub title: String,
    /// "constant" (fct_IDT = 0) or "curve" (uses `curve` -> /FUNCT or `existing_funct_id`)
    #[serde(default = "default_grav_mode")]
    pub mode: String,
    /// Signed acceleration magnitude in work units (for constant mode, or reference 1g scale in curve mode).
    #[serde(default)]
    pub magnitude: f64,
    /// "X" | "+X" | "-X" | "Y" | "+Y" | "-Y" | "Z" | "+Z" | "-Z"
    #[serde(default = "default_direction")]
    pub direction: String,
    /// Abscissa (time) scale factor Ascale_x (default 1.0).
    #[serde(default = "default_one")]
    pub a_scale: f64,
    /// Optional explicit ordinate scale factor Fscale_Y (overrides `magnitude` when present).
    #[serde(default)]
    pub f_scale: Option<f64>,
    /// Optional existing external /FUNCT ID when `mode == "curve"` and `curve` is empty.
    #[serde(default)]
    pub existing_funct_id: Option<u64>,
    /// Optional time-varying gravity curve points (`time`, `value`) -> generates `/FUNCT/<id>`.
    #[serde(default)]
    pub curve: Vec<RadiossCurvePoint>,
    /// Optional local Skew ID (0 = global).
    #[serde(default)]
    pub skew_id: Option<u64>,
    /// Optional Sensor ID (0 = active from t=0).
    #[serde(default)]
    pub sensor_id: Option<u64>,
    /// Optional node group /GRNOD ID (0 or None = whole model).
    #[serde(default)]
    pub grnod_id: Option<u64>,
}

/// Standalone / extra Radioss `/FUNCT` curve entry for tabular management & export.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossFunctionSpec {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub explicit_id: Option<u64>,
    #[serde(default)]
    pub points: Vec<RadiossCurvePoint>,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossThNodeEntry {
    pub node_id: u64,
    #[serde(default)]
    pub skew_id: u64,
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossThElemEntry {
    pub elem_id: u64,
    #[serde(default)]
    pub label: String,
}

fn default_true() -> bool {
    true
}

/// Radioss Time History (`/TH/<TYPE>`) output request card.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossTimeHistory {
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// "spring" | "beam" | "sectio" | "rbody" | "rwall" | "node" | "inter" | "part"
    pub kind: String,
    /// Engineering role tag (e.g. "bolt", "bcs", "rwall-rbe2", "rwall-node", "contact", "part", "custom")
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub variables: Vec<String>,
    #[serde(default)]
    pub nodes: Vec<RadiossThNodeEntry>,
    #[serde(default)]
    pub elements: Vec<RadiossThElemEntry>,
    #[serde(default)]
    pub object_ids: Vec<u64>,
    /// Optional 0-based indices into `spec.contacts` to automatically bind generated `/INTER/TYPE7` IDs.
    #[serde(default)]
    pub contact_indices: Vec<usize>,
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

fn default_istf() -> i32 {
    4
}
fn default_igap() -> i32 {
    2
}
fn default_idel() -> i32 {
    2
}
fn default_one() -> f64 {
    1.0
}
fn default_mesh_size() -> f64 {
    0.4
}
fn default_irem_gap() -> i32 {
    2
}
fn default_ibc() -> String {
    "000".into()
}
fn default_inacti() -> i32 {
    6
}
fn default_iform() -> i32 {
    2
}

/// Optional TYPE7 thermal continuation rows, required when Ithe = 1.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossContactThermal {
    #[serde(default)]
    pub coefficient: f64,
    #[serde(default)]
    pub function_id: u64,
    #[serde(default)]
    pub interface_temperature: f64,
    #[serde(default)]
    pub formulation: i32,
    #[serde(default = "default_one")]
    pub pressure_scale: f64,
    #[serde(default)]
    pub radiation_factor: f64,
    #[serde(default)]
    pub radiation_distance: f64,
    #[serde(default)]
    pub secondary_friction_heat: f64,
    #[serde(default)]
    pub main_friction_heat: f64,
}

/// Radioss 2022 `/INTER/TYPE7` contact interface specification for tool-to-model
/// (e.g. ROPS crush platen / FOPS drop-hammer vs cab/protective structure) contact.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossContact {
    #[serde(default)]
    pub title: String,
    /// Secondary (slave) node group Set ID (`grnd_IDs`, `/GRNOD`, model side).
    pub slave_grnod_id: u64,
    /// Main (master) surface Set ID (`surf_IDm`, `/SURF`, tooling side).
    pub master_surf_id: u64,
    // ---- Card 1 ----
    #[serde(default = "default_istf")]
    pub istf: i32,
    #[serde(default)]
    pub ithe: i32,
    #[serde(default = "default_igap")]
    pub igap: i32,
    #[serde(default)]
    pub ibag: i32,
    #[serde(default = "default_idel")]
    pub idel: i32,
    #[serde(default)]
    pub icurv: i32,
    #[serde(default)]
    pub iadm: i32,
    #[serde(default)]
    pub curv_node_id1: Option<u64>,
    #[serde(default)]
    pub curv_node_id2: Option<u64>,
    // ---- Card 2 ----
    #[serde(default = "default_one")]
    pub fscale_gap: f64,
    #[serde(default)]
    pub gap_max: f64,
    #[serde(default)]
    pub fpenmax: f64,
    #[serde(default)]
    pub i_tied: i32,
    // ---- Card 3 ----
    #[serde(default)]
    pub st_min: f64,
    #[serde(default)]
    pub st_max: f64,
    #[serde(default = "default_mesh_size")]
    pub percent_mesh_size: f64,
    #[serde(default)]
    pub dtmin: f64,
    #[serde(default = "default_irem_gap")]
    pub irem_gap: i32,
    #[serde(default)]
    pub irem_i2: i32,
    // ---- Card 4 ----
    #[serde(default = "default_one")]
    pub stfac: f64,
    #[serde(default)]
    pub fric: f64,
    #[serde(default)]
    pub gap_min: f64,
    #[serde(default)]
    pub t_start: f64,
    #[serde(default)]
    pub t_stop: f64,
    // ---- Card 5 ----
    #[serde(default = "default_ibc")]
    pub ibc: String,
    #[serde(default = "default_inacti")]
    pub inacti: i32,
    #[serde(default)]
    pub vis_s: f64,
    #[serde(default)]
    pub vis_f: f64,
    #[serde(default)]
    pub bumult: f64,
    // ---- Card 6 ----
    #[serde(default)]
    pub ifric: i32,
    #[serde(default)]
    pub ifiltr: i32,
    #[serde(default)]
    pub xfreq: f64,
    #[serde(default = "default_iform")]
    pub iform: i32,
    #[serde(default)]
    pub sens_id: u64,
    #[serde(default)]
    pub fct_id_f: u64,
    #[serde(default)]
    pub ascale_f: f64,
    #[serde(default)]
    pub fric_id: u64,
    // ---- Optional Card 7/8 (when ifric > 0) ----
    #[serde(default)]
    pub c1: f64,
    #[serde(default)]
    pub c2: f64,
    #[serde(default)]
    pub c3: f64,
    #[serde(default)]
    pub c4: f64,
    #[serde(default)]
    pub c5: f64,
    #[serde(default)]
    pub c6: f64,
    #[serde(default)]
    pub thermal: Option<RadiossContactThermal>,
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
    pub gravities: Vec<RadiossGravity>,
    #[serde(default)]
    pub functions: Vec<RadiossFunctionSpec>,
    #[serde(default)]
    pub time_histories: Vec<RadiossTimeHistory>,
    #[serde(default)]
    pub contacts: Vec<RadiossContact>,
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
