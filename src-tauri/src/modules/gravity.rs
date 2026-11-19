use std::collections::BTreeSet;

use crate::core::cards::{BulkCard, Vec3};
use crate::core::case_spec::GravitySpec;
use crate::core::deck_ir::{DeckFragment, GenerationContext, Subcase};
use crate::core::diagnostics::Diagnostic;
use crate::core::ids::IdKind;
use crate::core::units::UnitSystem;
use crate::core::validation::{require_finite, require_units};
use crate::modules::{ascii_name, static_outputs, BuiltCase};

pub fn generate(spec: &GravitySpec) -> BuiltCase {
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
    spec: &GravitySpec,
    key_prefix: &str,
    label_override: Option<&str>,
    spc_is_external: bool,
    ctx: &mut GenerationContext,
    frag: &mut DeckFragment,
) -> Option<u64> {
    let units = match require_units(&spec.model_units) {
        Ok(u) => Some(u),
        Err(d) => {
            ctx.diagnostics.push(d);
            None
        }
    };

    match spec.existing_spc_set_id {
        Some(0) => ctx.error("LC-REF-001", "外部 SPC Set ID 必须为正整数"),
        Some(id) if spc_is_external => {
            ctx.note_external(IdKind::Spc, id, Some("existing SPC set".into()), "gravity")
        }
        Some(_) => {}
        None => ctx.warn(
            "LC-REF-001",
            "未提供外部 SPC 集合：重力工况通常需要已有约束",
        ),
    }

    if !spec.cases.is_empty() {
        let mut seen_labels: BTreeSet<String> = BTreeSet::new();
        let mut sids = Vec::new();
        let multi_rows = spec.cases.len() > 1;
        for (i, row) in spec.cases.iter().enumerate() {
            let row_num = i + 1;
            let trimmed_name = row.name.trim();
            if trimmed_name.is_empty() {
                ctx.diagnostics.push(
                    Diagnostic::error("LC-INPUT-001", format!("第 {row_num} 行重力工况名称不能为空"))
                        .field(format!("cases[{i}].name")),
                );
            }
            if !row.acceleration.is_finite() || row.acceleration <= 0.0 {
                ctx.diagnostics.push(
                    Diagnostic::error(
                        "LC-INPUT-001",
                        format!("第 {row_num} 行重力加速度必须为正的有限值"),
                    )
                    .field(format!("cases[{i}].acceleration")),
                );
            }
            for (axis, val) in [("nx", row.nx), ("ny", row.ny), ("nz", row.nz)] {
                if let Err(d) = require_finite(val, &format!("cases[{i}].{axis}"), trimmed_name) {
                    ctx.diagnostics.push(d);
                }
            }
            let coeff = Vec3::new(row.nx, row.ny, row.nz);
            if coeff.magnitude() == 0.0 {
                ctx.diagnostics.push(
                    Diagnostic::error(
                        "LC-INPUT-001",
                        format!("第 {row_num} 行方向系数 (N1, N2, N3) 不能全为零"),
                    )
                    .field(format!("cases[{i}].direction")),
                );
            }
            if let Some(u) = units {
                if u == UnitSystem::NmmS
                    && row.acceleration.is_finite()
                    && row.acceleration > 0.0
                    && row.acceleration <= 20.0
                {
                    ctx.diagnostics.push(
                        Diagnostic::warning(
                            "LC-UNIT-002",
                            format!(
                                "第 {row_num} 行重力加速度（{}）数值较小，当前单位制为 N-mm-s（1g = 9806.65 mm/s²），请确认未按 g 倍数误填",
                                row.acceleration
                            ),
                        )
                        .field(format!("cases[{i}].acceleration")),
                    );
                }
            }

            if units.is_some()
                && !trimmed_name.is_empty()
                && row.acceleration.is_finite()
                && row.acceleration > 0.0
                && row.nx.is_finite()
                && row.ny.is_finite()
                && row.nz.is_finite()
                && coeff.magnitude() > 0.0
            {
                let base_label = ascii_name(trimmed_name);
                let label = match label_override {
                    Some(pfx) if !multi_rows => pfx.to_string(),
                    Some(pfx) => format!("{pfx}_{base_label}"),
                    None => base_label,
                };
                if !seen_labels.insert(label.clone()) {
                    ctx.warn(
                        "LC-INPUT-002",
                        format!(
                            "第 {row_num} 行生成了重复的子工况英文标签 “{label}”，建议区分工况名称"
                        ),
                    );
                }
                let sid = ctx.allocate(IdKind::Load, &format!("{key_prefix}#{trimmed_name}#grav#{i}"));
                sids.push(sid);
                frag.bulk_cards.push(BulkCard::Grav {
                    sid,
                    cid: row.cid,
                    scale: row.acceleration,
                    n: coeff,
                });
                let sc = ctx.allocate(IdKind::Subcase, &format!("{key_prefix}#{trimmed_name}#sub#{i}"));
                ctx.metadata("LOADCOLS", sid, format!("LC_{label}"));
                ctx.metadata("LOADSTEPS", sc, format!("LS_{label}"));
                frag.subcases.push(Subcase {
                    id: sc,
                    label,
                    analysis: Some("STATICS".into()),
                    spc: spec.existing_spc_set_id,
                    load: Some(sid),
                    outputs: static_outputs(&spec.output_profile),
                    ..Default::default()
                });
            }
        }
        if let Some(u) = units {
            let g_value = u.gravity();
            ctx.info(
                "LC-UNIT-001",
                format!(
                    "参考 1g = {g_value:.5}（{}），共配置 {} 个重力工况",
                    u.label(),
                    spec.cases.len()
                ),
            );
        }
        return if sids.len() == 1 { Some(sids[0]) } else { None };
    }

    // Legacy single-case fallback (used by golden & kernel tests).
    if spec.magnitude_g.is_none() && spec.direction.is_none() {
        ctx.error("LC-INPUT-001", "至少需要添加一条重力工况行");
        return None;
    }

    let magnitude_g = spec.magnitude_g.unwrap_or(0.0);
    let raw_dir = spec.direction.unwrap_or([0.0, 0.0, 0.0]);

    if !magnitude_g.is_finite() || magnitude_g <= 0.0 {
        ctx.error("LC-INPUT-001", "重力幅值必须为正的有限值（以 g 为单位）");
    }
    let direction = Vec3::new(raw_dir[0], raw_dir[1], raw_dir[2]);
    let unit_dir = match direction.normalized() {
        Some(v) => Some(v),
        None => {
            ctx.error("LC-INPUT-001", "重力方向向量不能为零");
            None
        }
    };

    if let (Some(units), Some(dir)) = (units, unit_dir) {
        let scale = magnitude_g * units.gravity();
        let sid = ctx.allocate(IdKind::Load, &format!("{key_prefix}#grav"));
        frag.bulk_cards.push(BulkCard::Grav {
            sid,
            cid: spec.cid,
            scale,
            n: dir,
        });
        let sc = ctx.allocate(IdKind::Subcase, &format!("{key_prefix}#sub"));
        let label = label_override
            .map(ToString::to_string)
            .unwrap_or_else(|| ascii_name(&spec.name));
        ctx.metadata("LOADCOLS", sid, format!("LC_{label}"));
        ctx.metadata("LOADSTEPS", sc, format!("LS_{label}"));
        frag.subcases.push(Subcase {
            id: sc,
            label,
            analysis: Some("STATICS".into()),
            spc: spec.existing_spc_set_id,
            load: Some(sid),
            outputs: static_outputs(&spec.output_profile),
            ..Default::default()
        });
        let g_value = units.gravity();
        ctx.info(
            "LC-UNIT-001",
            format!("参考 1g = {g_value:.5}（{}）", units.label()),
        );
        return Some(sid);
    }

    None
}
