//! Case generator modules. Each module owns its engineering semantics and emits
//! a `DeckFragment`; none of them format FEM text directly.

pub mod constraint;
pub mod frequency_response;
pub mod gravity;
pub mod nodal_static;
pub mod normal_modes;
pub mod random_psd;
pub mod radioss_fops;
pub mod radioss_rops;

use serde::Serialize;

use crate::core::deck_ir::{DeckFragment, GenerationContext};
use crate::core::diagnostics::Diagnostic;

pub struct BuiltCase {
    pub fragment: DeckFragment,
    pub ctx: GenerationContext,
}

impl BuiltCase {
    pub fn new(fragment: DeckFragment, ctx: GenerationContext) -> Self {
        Self { fragment, ctx }
    }

    /// Merge context diagnostics, fragment warnings and id-plan conflicts.
    pub fn diagnostics(&self) -> Vec<Diagnostic> {
        let mut all = self.ctx.diagnostics.clone();
        all.extend(self.fragment.warnings.iter().cloned());
        for conflict in self.ctx.allocator.conflicts() {
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

    pub fn has_errors(&self) -> bool {
        self.diagnostics().iter().any(Diagnostic::is_error)
    }
}

pub fn ascii_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "CASE".into()
    } else {
        trimmed.chars().take(48).collect()
    }
}

pub fn static_outputs(profile: &str) -> Vec<String> {
    match profile {
        "DISPLACEMENT_ONLY" => vec!["DISPLACEMENT = ALL".into()],
        _ => vec![
            "DISPLACEMENT = ALL".into(),
            "STRESS = ALL".into(),
            "STRAIN = ALL".into(),
        ],
    }
}

pub fn modal_outputs(_profile: &str) -> Vec<String> {
    vec!["DISPLACEMENT = ALL".into()]
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleDescriptor {
    pub id: String,
    pub title: String,
    pub category: String,
    pub solver: String,
    pub min_supported_version: String,
    pub status: String,
    pub help_key: String,
    pub capability_flags: Vec<String>,
}

pub fn module_descriptors() -> Vec<ModuleDescriptor> {
    let d = |id: &str, title: &str, category: &str, status: &str, help: &str, flags: &[&str]| {
        ModuleDescriptor {
            id: id.into(),
            title: title.into(),
            category: category.into(),
            solver: "optistruct".into(),
            min_supported_version: "2022".into(),
            status: status.into(),
            help_key: help.into(),
            capability_flags: flags.iter().map(|s| s.to_string()).collect(),
        }
    };
    let dr = |id: &str, title: &str, category: &str, status: &str, help: &str, flags: &[&str]| {
        ModuleDescriptor {
            id: id.into(),
            title: title.into(),
            category: category.into(),
            solver: "radioss".into(),
            min_supported_version: "2022".into(),
            status: status.into(),
            help_key: help.into(),
            capability_flags: flags.iter().map(|s| s.to_string()).collect(),
        }
    };
    vec![
        dr(
            "radioss-rops",
            "ROPS 受控位移",
            "radioss",
            "experimental",
            "radioss-rops",
            &["/GRNOD/NODE", "/FUNCT", "/IMPDISP", "单文件 .rad"],
        ),
        dr(
            "radioss-fops",
            "FOPS 落锤冲击",
            "radioss",
            "experimental",
            "radioss-fops",
            &["落锤位移曲线", "/IMPDISP", "冲击能量换算", "单文件 .rad"],
        ),
        d(
            "tabular-load",
            "整车工况生成",
            "vehicle",
            "stable",
            "tabular-load",
            &["表格粘贴", "点位归并", "增量 FEM + JSON"],
        ),
        d(
            "nodal-static",
            "节点力 / 力矩",
            "static",
            "beta",
            "nodal-static",
            &["force", "moment", "multi-node"],
        ),
        d(
            "constraint",
            "位移约束",
            "static",
            "beta",
            "constraint",
            &["spc", "spc1", "spcadd"],
        ),
        d(
            "gravity",
            "重力",
            "static",
            "beta",
            "gravity",
            &["grav", "unit-aware"],
        ),
        d(
            "normal-modes",
            "模态",
            "modal",
            "beta",
            "normal-modes",
            &["eigrl", "method"],
        ),
        d(
            "frequency-response",
            "频率响应",
            "dynamic",
            "experimental",
            "frequency-response",
            &["freq1", "tabdmp1", "rload2"],
        ),
        d(
            "random-psd",
            "PSD 随机振动",
            "dynamic",
            "beta",
            "random-psd",
            &["tabrnd1", "randps", "grms", "single-axis"],
        ),
    ]
}
