use crate::core::cards::{BulkCard, Vec3};
use crate::core::case_spec::{NodalLoadRow, NodalStaticSpec};
use crate::core::deck_ir::{DeckFragment, GenerationContext, Subcase};
use crate::core::ids::IdKind;
use crate::core::validation::{require_finite, require_units};
use crate::modules::{ascii_name, static_outputs, BuiltCase};

pub fn generate(spec: &NodalStaticSpec) -> BuiltCase {
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
    if spec.loads.is_empty() {
        ctx.error("LC-INPUT-001", "节点静力至少需要一条载荷行");
    }
    let spc = spec.existing_spc_set_id;
    match spc {
        Some(id) => ctx.note_external(
            IdKind::Spc,
            id,
            Some("existing SPC set".into()),
            "nodal-static",
        ),
        None => ctx.warn("LC-REF-001", "未提供外部 SPC 集合：模型可能无约束，请确认"),
    }

    if spec.per_row_subcase {
        for (i, row) in spec.loads.iter().enumerate() {
            let sid = ctx.allocate(IdKind::Load, &format!("{}#load#{}", spec.name, i));
            emit_cards(&mut frag, &mut ctx, sid, row);
            let sc = ctx.allocate(IdKind::Subcase, &format!("{}#sub#{}", spec.name, i));
            let label = format!("{}_{}", ascii_name(&spec.name), i + 1);
            ctx.metadata("LOADCOLS", sid, format!("LC_{label}"));
            ctx.metadata("LOADSTEPS", sc, format!("LS_{label}"));
            frag.subcases.push(Subcase {
                id: sc,
                label,
                analysis: Some("STATICS".into()),
                spc,
                load: Some(sid),
                outputs: static_outputs(&spec.output_profile),
                ..Default::default()
            });
        }
    } else {
        let sid = ctx.allocate(IdKind::Load, &format!("{}#load", spec.name));
        for row in &spec.loads {
            emit_cards(&mut frag, &mut ctx, sid, row);
        }
        let sc = ctx.allocate(IdKind::Subcase, &format!("{}#sub", spec.name));
        ctx.metadata("LOADCOLS", sid, format!("LC_{}", ascii_name(&spec.name)));
        ctx.metadata("LOADSTEPS", sc, format!("LS_{}", ascii_name(&spec.name)));
        frag.subcases.push(Subcase {
            id: sc,
            label: spec.name.clone(),
            analysis: Some("STATICS".into()),
            spc,
            load: Some(sid),
            outputs: static_outputs(&spec.output_profile),
            ..Default::default()
        });
    }

    BuiltCase::new(frag, ctx)
}

fn emit_cards(frag: &mut DeckFragment, ctx: &mut GenerationContext, sid: u64, row: &NodalLoadRow) {
    if row.node_id == 0 {
        ctx.error("LC-INPUT-001", "节点号必须为正整数");
        return;
    }
    for (field, value) in [
        ("fx", row.fx),
        ("fy", row.fy),
        ("fz", row.fz),
        ("mx", row.mx),
        ("my", row.my),
        ("mz", row.mz),
    ] {
        if let Err(d) = require_finite(value, field, &row.label) {
            ctx.diagnostics.push(d);
        }
    }
    let has_force = row.fx != 0.0 || row.fy != 0.0 || row.fz != 0.0;
    let has_moment = row.mx != 0.0 || row.my != 0.0 || row.mz != 0.0;
    if !has_force && !has_moment {
        ctx.warn(
            "LC-INPUT-001",
            format!("节点 {} 的载荷全部为 0", row.node_id),
        );
    }
    if has_force {
        frag.bulk_cards.push(BulkCard::Force {
            sid,
            gid: row.node_id,
            cid: row.cid,
            scale: 1.0,
            f: Vec3::new(row.fx, row.fy, row.fz),
        });
    }
    if has_moment {
        frag.bulk_cards.push(BulkCard::Moment {
            sid,
            gid: row.node_id,
            cid: row.cid,
            scale: 1.0,
            m: Vec3::new(row.mx, row.my, row.mz),
        });
    }
    ctx.note_external(
        IdKind::Node,
        row.node_id,
        Some(row.label.clone()),
        "nodal-static",
    );
}
