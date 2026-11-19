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
    let _ = generate_into(spec, &spec.name, None, true, &mut ctx, &mut frag);
    BuiltCase::new(frag, ctx)
}

pub fn generate_into(
    spec: &NodalStaticSpec,
    key_prefix: &str,
    label_override: Option<&str>,
    spc_is_external: bool,
    ctx: &mut GenerationContext,
    frag: &mut DeckFragment,
) -> Option<u64> {
    if let Err(d) = require_units(&spec.model_units) {
        ctx.diagnostics.push(d);
    }
    if spec.loads.is_empty() {
        ctx.error("LC-INPUT-001", "节点静力至少需要一条载荷行");
    }
    let spc = spec.existing_spc_set_id.filter(|id| *id > 0);
    match spec.existing_spc_set_id {
        Some(0) => ctx.error("LC-REF-001", "外部 SPC Set ID 必须为正整数"),
        Some(id) if spc_is_external => ctx.note_external(
            IdKind::Spc,
            id,
            Some("existing SPC set".into()),
            "nodal-static",
        ),
        Some(_) => {}
        None => ctx.warn("LC-REF-001", "未提供外部 SPC 集合：模型可能无约束，请确认"),
    }

    let base_ascii = label_override
        .map(ToString::to_string)
        .unwrap_or_else(|| ascii_name(&spec.name));

    if spec.per_row_subcase {
        for (i, row) in spec.loads.iter().enumerate() {
            let sid = ctx.allocate(IdKind::Load, &format!("{key_prefix}#load#{i}"));
            let emitted = emit_cards(frag, ctx, sid, row);
            if !emitted {
                ctx.error(
                    "LC-INPUT-001",
                    format!("第 {} 行载荷全为 0，独立子工况不能缺少载荷卡片", i + 1),
                );
            }
            let sc = ctx.allocate(IdKind::Subcase, &format!("{key_prefix}#sub#{i}"));
            let label = format!("{base_ascii}_{}", i + 1);
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
        None
    } else {
        let sid = ctx.allocate(IdKind::Load, &format!("{key_prefix}#load"));
        let mut any_emitted = false;
        for row in &spec.loads {
            any_emitted |= emit_cards(frag, ctx, sid, row);
        }
        if !spec.loads.is_empty() && !any_emitted {
            ctx.error(
                "LC-INPUT-001",
                "节点静力工况所有载荷行均全为 0，无法生成有效 LOAD 卡片",
            );
        }
        let sc = ctx.allocate(IdKind::Subcase, &format!("{key_prefix}#sub"));
        ctx.metadata("LOADCOLS", sid, format!("LC_{base_ascii}"));
        ctx.metadata("LOADSTEPS", sc, format!("LS_{base_ascii}"));
        frag.subcases.push(Subcase {
            id: sc,
            label: label_override
                .map(ToString::to_string)
                .unwrap_or_else(|| spec.name.clone()),
            analysis: Some("STATICS".into()),
            spc,
            load: Some(sid),
            outputs: static_outputs(&spec.output_profile),
            ..Default::default()
        });
        Some(sid)
    }
}

fn emit_cards(frag: &mut DeckFragment, ctx: &mut GenerationContext, sid: u64, row: &NodalLoadRow) -> bool {
    if row.node_id == 0 {
        ctx.error("LC-INPUT-001", "节点号必须为正整数");
        return false;
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
    has_force || has_moment
}
