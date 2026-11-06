use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::core::case_spec::CaseSpec;
use crate::core::deck_ir::{DeckFragment, GenerationContext};
use crate::core::diagnostics::{Diagnostic, ValidationReport};
use crate::core::ids::IdAssignment;
use crate::core::references::ExternalReference;
use crate::modules::{self, BuiltCase};
use crate::solvers::optistruct::{write_fem, WriteInput, WriterOptions};

use crate::core::radioss_deck::RadiossBuilt;
use crate::core::radioss_spec::{RadiossFopsSpec, RadiossRopsSpec};
use crate::solvers::radioss::{write_rad, RadiossWriteInput};

/// Solver-agnostic view of an external reference for the UI / manifest.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceView {
    pub kind: String,
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub status: String,
    pub used_by: String,
}

/// Solver-agnostic view of a generated-id assignment for the UI / manifest.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdPlanView {
    pub kind: String,
    pub key: String,
    pub id: u64,
}

impl From<&ExternalReference> for ReferenceView {
    fn from(r: &ExternalReference) -> Self {
        Self {
            kind: r.kind.key().to_string(),
            id: r.id,
            label: r.label.clone(),
            status: r.status.clone(),
            used_by: r.used_by.clone(),
        }
    }
}

impl From<&IdAssignment> for IdPlanView {
    fn from(a: &IdAssignment) -> Self {
        Self {
            kind: a.kind.key().to_string(),
            key: a.key.clone(),
            id: a.id,
        }
    }
}

impl From<&crate::core::radioss_deck::RadiossExternalRef> for ReferenceView {
    fn from(r: &crate::core::radioss_deck::RadiossExternalRef) -> Self {
        Self {
            kind: r.kind.clone(),
            id: r.id,
            label: r.label.clone(),
            status: r.status.clone(),
            used_by: r.used_by.clone(),
        }
    }
}

impl From<&crate::core::radioss_deck::RadiossIdAssignment> for IdPlanView {
    fn from(a: &crate::core::radioss_deck::RadiossIdAssignment) -> Self {
        Self {
            kind: a.kind.clone(),
            key: a.key.clone(),
            id: a.id,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseRequest {
    pub case: CaseSpec,
    #[serde(default)]
    pub project_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSummary {
    pub sol: Option<u32>,
    pub subcase_count: usize,
    pub card_counts: BTreeMap<String, usize>,
    pub line_count: usize,
    pub can_export: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub kind: String,
    pub diagnostics: Vec<Diagnostic>,
    pub fem_preview: String,
    pub external_references: Vec<ReferenceView>,
    pub id_plan: Vec<IdPlanView>,
    pub summary: PreviewSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResultV2 {
    pub kind: String,
    pub diagnostics: Vec<Diagnostic>,
    pub files: BTreeMap<String, String>,
    pub external_references: Vec<ReferenceView>,
    pub id_plan: Vec<IdPlanView>,
}

struct Produced {
    kind: String,
    diagnostics: Vec<Diagnostic>,
    external: Vec<ReferenceView>,
    id_plan: Vec<IdPlanView>,
    fem: String,
    files: BTreeMap<String, String>,
    sol: Option<u32>,
    card_counts: BTreeMap<String, usize>,
    subcase_count: usize,
}

fn generate_fragment(spec: &CaseSpec) -> Option<BuiltCase> {
    Some(match spec {
        CaseSpec::NodalStatic(s) => modules::nodal_static::generate(s),
        CaseSpec::Gravity(s) => modules::gravity::generate(s),
        CaseSpec::Constraint(s) => modules::constraint::generate(s),
        CaseSpec::NormalModes(s) => modules::normal_modes::generate(s),
        CaseSpec::FrequencyResponse(s) => modules::frequency_response::generate(s),
        CaseSpec::RandomPsd(s) => modules::random_psd::generate(s),
        CaseSpec::TabularLoad(_) => return None,
        CaseSpec::RadiossRops(_) => return None,
        CaseSpec::RadiossFops(_) => return None,
    })
}

fn produced_for(request: &CaseRequest) -> Produced {
    let kind = request.case.kind().to_string();
    let title = request
        .project_name
        .clone()
        .unwrap_or_else(|| request.case.display_name());

    if let CaseSpec::RadiossRops(spec) = &request.case {
        return produced_radioss(spec);
    }

    if let CaseSpec::RadiossFops(spec) = &request.case {
        return produced_radioss_fops(spec);
    }

    if let CaseSpec::TabularLoad(spec) = &request.case {
        let legacy_request = crate::load_deck::BuildRequest {
            project_name: if spec.project_name.is_empty() {
                title.clone()
            } else {
                spec.project_name.clone()
            },
            rows: spec.rows.clone(),
            case_aliases: spec.case_aliases.clone(),
            coordinate_tolerance: spec.coordinate_tolerance,
        };
        return match crate::load_deck::build_load_deck(legacy_request) {
            Ok(built) => {
                let diagnostics = built
                    .warnings
                    .iter()
                    .map(|w| Diagnostic::warning("LC-INPUT-001", w.clone()))
                    .collect();
                let mut files = BTreeMap::new();
                files.insert(format!("{}.fem", title), built.fem.clone());
                files.insert(format!("{}_points.json", title), built.json.clone());
                Produced {
                    kind,
                    diagnostics,
                    external: Vec::new(),
                    id_plan: Vec::new(),
                    fem: built.fem,
                    files,
                    sol: Some(101),
                    card_counts: BTreeMap::new(),
                    subcase_count: built.cases.len(),
                }
            }
            Err(err) => Produced {
                kind,
                diagnostics: vec![Diagnostic::error("LC-INPUT-001", err)],
                external: Vec::new(),
                id_plan: Vec::new(),
                fem: String::new(),
                files: BTreeMap::new(),
                sol: None,
                card_counts: BTreeMap::new(),
                subcase_count: 0,
            },
        };
    }

    let Some(built) = generate_fragment(&request.case) else {
        unreachable!("tabular handled above")
    };
    let BuiltCase { fragment, ctx } = built;
    let mut diagnostics = merge_diagnostics(&fragment, &ctx);

    let mut frag: DeckFragment = fragment;
    frag.external_refs = ctx.external_refs.clone();
    frag.metadata = ctx.metadata.clone();

    let mut card_counts: BTreeMap<String, usize> = BTreeMap::new();
    for card in &frag.bulk_cards {
        *card_counts.entry(card.card_name().to_string()).or_default() += 1;
    }
    let subcase_count = frag.subcases.len();

    let mut fem = String::new();
    let has_errors = diagnostics.iter().any(Diagnostic::is_error);
    if !has_errors {
        let opts = WriterOptions::default();
        match write_fem(
            &WriteInput {
                title: &title,
                solver: &ctx.solver,
                solver_version: &ctx.solver_version,
                fragment: &frag,
            },
            &opts,
        ) {
            Ok(text) => fem = text,
            Err(d) => diagnostics.push(d),
        }
    }

    let mut files = BTreeMap::new();
    if !fem.is_empty() {
        files.insert(format!("{}.fem", title), fem.clone());
        let mut manifest = serde_json::Map::new();
        manifest.insert("schemaVersion".into(), serde_json::json!(2));
        manifest.insert("caseKind".into(), serde_json::json!(kind));
        manifest.insert("solver".into(), serde_json::json!(ctx.solver));
        manifest.insert(
            "solverVersion".into(),
            serde_json::json!(ctx.solver_version),
        );
        manifest.insert("modelUnits".into(), serde_json::json!(ctx.model_units));
        manifest.insert(
            "externalReferences".into(),
            serde_json::to_value(&ctx.external_refs).unwrap_or(serde_json::Value::Null),
        );
        manifest.insert(
            "generatedIdMap".into(),
            serde_json::to_value(ctx.allocator.assignments()).unwrap_or(serde_json::Value::Null),
        );
        manifest.insert("validationStatus".into(), serde_json::json!("generated"));
        files.insert(
            format!("{}.manifest.json", title),
            serde_json::to_string_pretty(&manifest).unwrap_or_default(),
        );
    }

    Produced {
        kind,
        diagnostics,
        external: ctx.external_refs.iter().map(ReferenceView::from).collect(),
        id_plan: ctx
            .allocator
            .assignments()
            .iter()
            .map(IdPlanView::from)
            .collect(),
        fem,
        files,
        sol: frag.sol,
        card_counts,
        subcase_count,
    }
}

/// Build a Radioss ROPS increment: single-file .rad plus a manifest sidecar.
fn produced_radioss(spec: &RadiossRopsSpec) -> Produced {
    let built = modules::radioss_rops::generate(spec);
    produced_radioss_common("radioss-rops", spec, built)
}

/// Build a Radioss FOPS (drop-hammer, controlled-displacement) increment.
fn produced_radioss_fops(spec: &RadiossFopsSpec) -> Produced {
    let built = modules::radioss_fops::generate(spec);
    produced_radioss_common("radioss-fops", &spec.base, built)
}

fn produced_radioss_common(kind: &str, spec: &RadiossRopsSpec, built: RadiossBuilt) -> Produced {
    let mut diagnostics = built.diagnostics.clone();
    let external: Vec<ReferenceView> = built.external.iter().map(ReferenceView::from).collect();
    let id_plan: Vec<IdPlanView> = built.id_plan.iter().map(IdPlanView::from).collect();
    let stem = modules::radioss_rops::ascii_stem(&spec.run_name);
    let filename = format!("{stem}_0000.rad");

    let mut fem = String::new();
    let has_errors = diagnostics.iter().any(Diagnostic::is_error);
    if !has_errors {
        match write_rad(&RadiossWriteInput {
            solver: &spec.solver,
            solver_version: &spec.solver_version,
            run_name: &spec.run_name,
            input_units: spec.units.input.as_array(),
            work_units: spec.units.work.as_array(),
            deck: &built.deck,
        }) {
            Ok(text) => fem = text,
            Err(d) => diagnostics.push(d),
        }
    }

    let mut files = BTreeMap::new();
    if !fem.is_empty() {
        files.insert(filename.clone(), fem.clone());
        let mut manifest = serde_json::Map::new();
        manifest.insert("schemaVersion".into(), serde_json::json!(2));
        manifest.insert("caseKind".into(), serde_json::json!(kind));
        manifest.insert("solver".into(), serde_json::json!(spec.solver));
        manifest.insert("solverVersion".into(), serde_json::json!(spec.solver_version));
        manifest.insert(
            "units".into(),
            serde_json::json!({
                "input": spec.units.input.as_array(),
                "work": spec.units.work.as_array(),
                "confirmedAgainstTargetModel": spec.units.confirmed_against_target_model,
            }),
        );
        manifest.insert(
            "externalReferences".into(),
            serde_json::to_value(&built.external).unwrap_or(serde_json::Value::Null),
        );
        manifest.insert(
            "generatedIdMap".into(),
            serde_json::to_value(&built.id_plan).unwrap_or(serde_json::Value::Null),
        );
        manifest.insert("validationStatus".into(), serde_json::json!("generated"));
        manifest.insert(
            "compatibilityProfile".into(),
            serde_json::json!("hm2023.0-rad2022-p0-pending"),
        );
        files.insert(
            format!("{stem}_0000.manifest.json"),
            serde_json::to_string_pretty(&manifest).unwrap_or_default(),
        );
    }

    Produced {
        kind: kind.into(),
        diagnostics,
        external,
        id_plan,
        fem,
        files,
        sol: None,
        card_counts: built.card_counts.clone(),
        subcase_count: 1,
    }
}

fn merge_diagnostics(fragment: &DeckFragment, ctx: &GenerationContext) -> Vec<Diagnostic> {
    let mut all = ctx.diagnostics.clone();
    all.extend(fragment.warnings.iter().cloned());
    for conflict in ctx.allocator.conflicts() {
        all.push(
            Diagnostic::error(
                "LC-ID-001",
                format!(
                    "生成的 {} 编号 {} 与外部引用“{}”冲突",
                    conflict.kind.label(),
                    conflict.id,
                    conflict.external_label.clone().unwrap_or_default()
                ),
            )
            .field(conflict.generated_key.clone()),
        );
    }
    all
}

#[tauri::command]
pub fn list_case_modules() -> Vec<modules::ModuleDescriptor> {
    modules::module_descriptors()
}

pub fn validate_request(request: &CaseRequest) -> ValidationReport {
    let produced = produced_for(request);
    ValidationReport {
        diagnostics: produced.diagnostics,
    }
}

#[tauri::command]
pub fn validate_case(request: CaseRequest) -> ValidationReport {
    validate_request(&request)
}

#[tauri::command]
pub fn preview_case(request: CaseRequest) -> PreviewResult {
    let produced = produced_for(&request);
    let can_export =
        !produced.diagnostics.iter().any(Diagnostic::is_error) && !produced.fem.is_empty();
    let line_count = produced.fem.lines().count();
    PreviewResult {
        kind: produced.kind,
        diagnostics: produced.diagnostics,
        fem_preview: produced.fem,
        external_references: produced.external,
        id_plan: produced.id_plan,
        summary: PreviewSummary {
            sol: produced.sol,
            subcase_count: produced.subcase_count,
            card_counts: produced.card_counts,
            line_count,
            can_export,
        },
    }
}

#[tauri::command]
pub fn build_case(request: CaseRequest) -> BuildResultV2 {
    let produced = produced_for(&request);
    BuildResultV2 {
        kind: produced.kind,
        diagnostics: produced.diagnostics,
        files: produced.files,
        external_references: produced.external,
        id_plan: produced.id_plan,
    }
}
