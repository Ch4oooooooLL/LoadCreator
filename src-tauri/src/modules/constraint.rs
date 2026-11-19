use std::collections::BTreeMap;

use crate::core::cards::BulkCard;
use crate::core::case_spec::ConstraintSpec;
use crate::core::deck_ir::{DeckFragment, GenerationContext};
use crate::core::ids::IdKind;
use crate::core::validation::{require_dofs, require_finite, require_units};
use crate::modules::{ascii_name, BuiltCase};

#[derive(Debug, Clone, Default)]
pub struct ConstraintOutput {
    pub spc_sid: Option<u64>,
    pub spc_add_sid: Option<u64>,
    pub effective_spc_sid: Option<u64>,
    pub constrained_node_dofs: BTreeMap<u64, Vec<u32>>,
}

pub fn generate(spec: &ConstraintSpec) -> BuiltCase {
    let mut ctx = GenerationContext::new(
        &spec.solver,
        &spec.solver_version,
        &spec.model_units,
        spec.id_policy.clone(),
    );
    let mut frag = DeckFragment::new(101);
    let _ = generate_into(spec, &spec.name, None, true, &mut ctx, &mut frag);
    BuiltCase::new(frag, ctx)
}

pub fn generate_into(
    spec: &ConstraintSpec,
    key_prefix: &str,
    label_override: Option<&str>,
    register_external: bool,
    ctx: &mut GenerationContext,
    frag: &mut DeckFragment,
) -> ConstraintOutput {
    let mut out = ConstraintOutput::default();
    let label = label_override
        .map(ToString::to_string)
        .unwrap_or_else(|| ascii_name(&spec.name));

    if let Err(d) = require_units(&spec.model_units) {
        ctx.diagnostics.push(d);
    }

    if !matches!(spec.mode.as_str(), "new" | "reference") {
        ctx.error("LC-INPUT-001", "约束模式必须为 new 或 reference");
    }

    for id in &spec.existing_spc_set_ids {
        if *id == 0 {
            ctx.error("LC-REF-001", "外部 SPC 集合编号必须为正整数");
        } else if register_external {
            ctx.note_external(
                IdKind::Spc,
                *id,
                Some("existing SPC set".into()),
                "constraint",
            );
        }
    }

    if spec.mode == "reference" {
        if spec.existing_spc_set_ids.is_empty() {
            ctx.error(
                "LC-REF-001",
                "reference 模式必须至少提供一个外部 SPC 集合编号",
            );
        } else if spec.existing_spc_set_ids.len() == 1 {
            out.effective_spc_sid = spec.existing_spc_set_ids.first().copied().filter(|id| *id > 0);
        } else if spec.combine_with_existing {
            let add_sid = ctx.allocate(IdKind::SpcAdd, &format!("{key_prefix}#spcadd"));
            frag.bulk_cards.push(BulkCard::SpcAdd {
                sid: add_sid,
                sets: spec.existing_spc_set_ids.clone(),
            });
            ctx.metadata("LOADCOLS", add_sid, format!("SPCADD_{label}"));
            out.spc_add_sid = Some(add_sid);
            out.effective_spc_sid = Some(add_sid);
        } else {
            ctx.error(
                "LC-REF-001",
                "引用多个外部 SPC 集合时必须启用 SPCADD 组合",
            );
        }
        return out;
    }

    if spec.rows.is_empty() {
        ctx.error("LC-INPUT-001", "约束至少需要一行节点/自由度");
    }

    // Validate rows first.
    for (i, row) in spec.rows.iter().enumerate() {
        if row.node_id == 0 {
            ctx.error("LC-INPUT-001", format!("第 {} 行节点号必须为正整数", i + 1));
        }
        if let Err(d) = require_dofs(&row.dofs, &format!("rows[{i}].dofs")) {
            ctx.diagnostics.push(d);
        }
        if let Some(value) = row.value {
            if let Err(d) = require_finite(value, &format!("rows[{i}].value"), "强迫位移") {
                ctx.diagnostics.push(d);
            }
        }
    }

    let spc_sid = ctx.allocate(IdKind::Spc, &format!("{key_prefix}#spc"));
    ctx.metadata("LOADCOLS", spc_sid, format!("SPC_{label}"));
    out.spc_sid = Some(spc_sid);
    out.effective_spc_sid = Some(spc_sid);

    for row in &spec.rows {
        if row.node_id == 0 || row.dofs.is_empty() {
            continue;
        }
        // Canonical sorted unique DOFs (1..=6) prevent duplicate digits like "112" in SPC1.
        let mut unique_dofs: Vec<u32> = row
            .dofs
            .iter()
            .copied()
            .filter(|d| (1..=6).contains(d))
            .collect();
        unique_dofs.sort_unstable();
        unique_dofs.dedup();
        if unique_dofs.is_empty() {
            continue;
        }
        out.constrained_node_dofs
            .entry(row.node_id)
            .or_default()
            .extend(unique_dofs.iter().copied());
        let dofs: String = unique_dofs.iter().map(|d| d.to_string()).collect();
        match row.value {
            Some(value) if value != 0.0 => {
                for dof in &unique_dofs {
                    frag.bulk_cards.push(BulkCard::Spc {
                        sid: spc_sid,
                        gid: row.node_id,
                        c: dof.to_string(),
                        d: value,
                    });
                }
            }
            _ => {
                frag.bulk_cards.push(BulkCard::Spc1 {
                    sid: spc_sid,
                    dofs,
                    nodes: vec![row.node_id],
                });
            }
        }
        if register_external {
            ctx.note_external(IdKind::Node, row.node_id, None, "constraint");
        }
    }

    if spec.combine_with_existing && !spec.existing_spc_set_ids.is_empty() {
        let add_sid = ctx.allocate(IdKind::SpcAdd, &format!("{key_prefix}#spcadd"));
        let mut sets = vec![spc_sid];
        sets.extend(spec.existing_spc_set_ids.iter().copied());
        frag.bulk_cards
            .push(BulkCard::SpcAdd { sid: add_sid, sets });
        ctx.metadata("LOADCOLS", add_sid, format!("SPCADD_{label}"));
        out.spc_add_sid = Some(add_sid);
        out.effective_spc_sid = Some(add_sid);
        ctx.warn(
            "LC-REF-001",
            "SPCADD 组合了外部约束集合，请确认不会覆盖原模型的约束语义",
        );
    }

    out
}
