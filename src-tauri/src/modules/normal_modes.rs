use crate::core::cards::BulkCard;
use crate::core::case_spec::NormalModesSpec;
use crate::core::deck_ir::{DeckFragment, GenerationContext, Subcase};
use crate::core::ids::IdKind;
use crate::core::validation::require_units;
use crate::modules::{ascii_name, modal_outputs, BuiltCase};

pub fn generate(spec: &NormalModesSpec) -> BuiltCase {
    let mut ctx = GenerationContext::new(
        &spec.solver,
        &spec.solver_version,
        &spec.model_units,
        spec.id_policy.clone(),
    );
    let mut frag = DeckFragment::new(103);
    generate_into(spec, &spec.name, None, true, &mut ctx, &mut frag);
    BuiltCase::new(frag, ctx)
}

pub fn generate_into(
    spec: &NormalModesSpec,
    key_prefix: &str,
    label_override: Option<&str>,
    spc_is_external: bool,
    ctx: &mut GenerationContext,
    frag: &mut DeckFragment,
) {
    if let Err(d) = require_units(&spec.model_units) {
        ctx.diagnostics.push(d);
    }

    match spec.existing_spc_set_id {
        Some(0) => ctx.error("LC-REF-001", "外部 SPC Set ID 必须为正整数"),
        Some(id) if spc_is_external => ctx.note_external(
            IdKind::Spc,
            id,
            Some("existing SPC set".into()),
            "normal-modes",
        ),
        Some(_) => {}
        None => ctx.warn(
            "LC-REF-001",
            "未提供外部约束集合：自由模型会出现刚体模态，请确认",
        ),
    }

    if let Some(min) = spec.eigrl_min_hz {
        if !min.is_finite() || min < 0.0 {
            ctx.error("LC-INPUT-001", "模态频率下限 V1 必须为非负有限值");
        }
    }
    if let Some(max) = spec.eigrl_max_hz {
        if !max.is_finite() || max <= 0.0 {
            ctx.error("LC-INPUT-001", "模态频率上限 V2 必须为正的有限值");
        }
    }
    if let (Some(min), Some(max)) = (spec.eigrl_min_hz, spec.eigrl_max_hz) {
        if min.is_finite() && max.is_finite() && max <= min {
            ctx.error("LC-INPUT-001", "模态频率上限必须大于下限");
        }
    }
    if spec.num_modes == Some(0) {
        ctx.error("LC-INPUT-001", "提取模态阶数 ND 必须为正整数");
    }
    if spec.num_modes.is_none() && spec.eigrl_max_hz.is_none() {
        ctx.warn(
            "LC-INPUT-001",
            "未给出模态阶数或频率上限，将使用默认提取范围",
        );
    }

    let label = label_override
        .map(ToString::to_string)
        .unwrap_or_else(|| ascii_name(&spec.name));
    let method_sid = ctx.allocate(IdKind::Method, &format!("{key_prefix}#eigrl"));
    frag.bulk_cards.push(BulkCard::Eigrl {
        sid: method_sid,
        nd: spec.num_modes,
        v1: spec.eigrl_min_hz,
        v2: spec.eigrl_max_hz,
    });
    ctx.metadata("LOADCOLS", method_sid, format!("EIGRL_{label}"));

    let sc = ctx.allocate(IdKind::Subcase, &format!("{key_prefix}#sub"));
    ctx.metadata("LOADSTEPS", sc, format!("LS_{label}"));
    frag.subcases.push(Subcase {
        id: sc,
        label,
        analysis: Some("MODES".into()),
        spc: spec.existing_spc_set_id.filter(|id| *id > 0),
        method: Some(method_sid),
        outputs: modal_outputs(&spec.output_profile),
        ..Default::default()
    });

    let _ = &spec.method_solver;
}
