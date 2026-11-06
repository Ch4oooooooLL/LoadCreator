use crate::core::cards::BulkCard;
use crate::core::case_spec::ConstraintSpec;
use crate::core::deck_ir::{DeckFragment, GenerationContext};
use crate::core::ids::IdKind;
use crate::core::validation::{require_dofs, require_finite, require_units};
use crate::modules::{ascii_name, BuiltCase};

pub fn generate(spec: &ConstraintSpec) -> BuiltCase {
    let mut ctx = GenerationContext::new(
        &spec.solver,
        &spec.solver_version,
        &spec.model_units,
        spec.id_policy.clone(),
    );
    let mut frag = DeckFragment::new(101);

    if let Err(d) = require_units(&spec.model_units) {
        ctx.diagnostics.push(d);
    }

    for id in &spec.existing_spc_set_ids {
        ctx.note_external(
            IdKind::Spc,
            *id,
            Some("existing SPC set".into()),
            "constraint",
        );
    }

    if spec.mode == "reference" {
        if spec.existing_spc_set_ids.is_empty() {
            ctx.error(
                "LC-REF-001",
                "reference 模式必须至少提供一个外部 SPC 集合编号",
            );
        }
        return BuiltCase::new(frag, ctx);
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

    let spc_sid = ctx.allocate(IdKind::Spc, &format!("{}#spc", spec.name));
    ctx.metadata(
        "LOADCOLS",
        spc_sid,
        format!("SPC_{}", ascii_name(&spec.name)),
    );

    for row in &spec.rows {
        if row.node_id == 0 || row.dofs.is_empty() {
            continue;
        }
        let dofs: String = row.dofs.iter().map(|d| d.to_string()).collect();
        match row.value {
            Some(value) if value != 0.0 => {
                for dof in &row.dofs {
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
                    ps: String::new(),
                    c: String::new(),
                    dofs,
                    nodes: vec![row.node_id],
                });
            }
        }
        ctx.note_external(IdKind::Node, row.node_id, None, "constraint");
    }

    if spec.combine_with_existing && !spec.existing_spc_set_ids.is_empty() {
        let add_sid = ctx.allocate(IdKind::SpcAdd, &format!("{}#spcadd", spec.name));
        let mut sets = vec![spc_sid];
        sets.extend(spec.existing_spc_set_ids.iter().copied());
        frag.bulk_cards
            .push(BulkCard::SpcAdd { sid: add_sid, sets });
        ctx.metadata(
            "LOADCOLS",
            add_sid,
            format!("SPCADD_{}", ascii_name(&spec.name)),
        );
        ctx.warn(
            "LC-REF-001",
            "SPCADD 组合了外部约束集合，请确认不会覆盖原模型的约束语义",
        );
    }

    BuiltCase::new(frag, ctx)
}
