use crate::core::cards::{BulkCard, Vec3};
use crate::core::case_spec::GravitySpec;
use crate::core::deck_ir::{DeckFragment, GenerationContext, Subcase};
use crate::core::ids::IdKind;
use crate::core::validation::require_units;
use crate::modules::{ascii_name, static_outputs, BuiltCase};

pub fn generate(spec: &GravitySpec) -> BuiltCase {
    let mut ctx = GenerationContext::new(
        &spec.solver,
        &spec.solver_version,
        &spec.model_units,
        spec.id_policy.clone(),
    );
    let mut frag = DeckFragment::new(101);

    let units = match require_units(&spec.model_units) {
        Ok(u) => Some(u),
        Err(d) => {
            ctx.diagnostics.push(d);
            None
        }
    };

    if !spec.magnitude_g.is_finite() || spec.magnitude_g <= 0.0 {
        ctx.error("LC-INPUT-001", "重力幅值必须为正的有限值（以 g 为单位）");
    }
    let direction = Vec3::new(spec.direction[0], spec.direction[1], spec.direction[2]);
    let unit_dir = match direction.normalized() {
        Some(v) => Some(v),
        None => {
            ctx.error("LC-INPUT-001", "重力方向向量不能为零");
            None
        }
    };

    match spec.existing_spc_set_id {
        Some(id) => ctx.note_external(IdKind::Spc, id, Some("existing SPC set".into()), "gravity"),
        None => ctx.warn(
            "LC-REF-001",
            "未提供外部 SPC 集合：重力工况通常需要已有约束",
        ),
    }

    if let (Some(units), Some(dir)) = (units, unit_dir) {
        let scale = spec.magnitude_g * units.gravity();
        let sid = ctx.allocate(IdKind::Load, &format!("{}#grav", spec.name));
        frag.bulk_cards.push(BulkCard::Grav {
            sid,
            cid: spec.cid,
            scale,
            n: dir,
        });
        let sc = ctx.allocate(IdKind::Subcase, &format!("{}#sub", spec.name));
        let label = ascii_name(&spec.name);
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
    }

    BuiltCase::new(frag, ctx)
}
