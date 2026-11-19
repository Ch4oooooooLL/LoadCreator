use crate::core::cards::BulkCard;
use crate::core::case_spec::FrequencyResponseSpec;
use crate::core::deck_ir::{DeckFragment, GenerationContext, Subcase};
use crate::core::ids::IdKind;
use crate::core::validation::require_units;
use crate::modules::{ascii_name, BuiltCase};

pub fn generate(spec: &FrequencyResponseSpec) -> BuiltCase {
    let mut ctx = GenerationContext::new(
        &spec.solver,
        &spec.solver_version,
        &spec.model_units,
        spec.id_policy.clone(),
    );
    let mut frag = DeckFragment::new(108);
    generate_into(spec, &spec.name, None, true, true, &mut ctx, &mut frag);
    BuiltCase::new(frag, ctx)
}

pub fn generate_into(
    spec: &FrequencyResponseSpec,
    key_prefix: &str,
    label_override: Option<&str>,
    spc_is_external: bool,
    load_is_external: bool,
    ctx: &mut GenerationContext,
    frag: &mut DeckFragment,
) {
    if let Err(d) = require_units(&spec.model_units) {
        ctx.diagnostics.push(d);
    }
    if spec.existing_spc_set_id == 0 {
        ctx.error("LC-REF-001", "外部 SPC Set ID 必须为正整数");
    }
    if spec.load_id == Some(0) {
        ctx.error("LC-REF-001", "外部载荷 DLOAD/RLOAD ID 必须为正整数");
    }
    if !spec.frequency_min_hz.is_finite() || spec.frequency_min_hz < 0.0 {
        ctx.error("LC-INPUT-001", "扫频下限必须为非负有限值");
    }
    if !(spec.frequency_step_hz.is_finite() && spec.frequency_step_hz > 0.0) {
        ctx.error("LC-INPUT-001", "频率步长必须为正的有限值");
    }
    if !spec.frequency_max_hz.is_finite() || spec.frequency_max_hz <= spec.frequency_min_hz {
        ctx.error("LC-INPUT-001", "频率上限必须大于下限");
    }
    if !spec.eigrl_min_hz.is_finite() || spec.eigrl_min_hz < 0.0 {
        ctx.error("LC-INPUT-001", "模态提取下限 V1 必须为非负有限值");
    }
    if !spec.eigrl_max_hz.is_finite() || spec.eigrl_max_hz <= spec.eigrl_min_hz {
        ctx.error("LC-INPUT-001", "模态提取上限 V2 必须大于下限 V1");
    }
    if !spec.damping_ratio.is_finite() || spec.damping_ratio < 0.0 || spec.damping_ratio >= 1.0 {
        ctx.error("LC-INPUT-001", "模态临界阻尼比必须在 [0, 1) 区间");
    }
    if spc_is_external && spec.existing_spc_set_id > 0 {
        ctx.note_external(
            IdKind::Spc,
            spec.existing_spc_set_id,
            Some("existing SPC set".into()),
            "frequency-response",
        );
    }
    if load_is_external {
        if let Some(load) = spec.load_id.filter(|id| *id > 0) {
            ctx.note_external(
                IdKind::Dload,
                load,
                Some("existing dynamic load (DLOAD/RLOAD)".into()),
                "frequency-response",
            );
        }
    }

    let eigrl = ctx.allocate(IdKind::Method, &format!("{key_prefix}#eigrl"));
    frag.bulk_cards.push(BulkCard::Eigrl {
        sid: eigrl,
        nd: None,
        v1: Some(spec.eigrl_min_hz),
        v2: Some(spec.eigrl_max_hz),
    });

    let freq = ctx.allocate(IdKind::Freq, &format!("{key_prefix}#freq"));
    let span = (spec.frequency_max_hz - spec.frequency_min_hz) / spec.frequency_step_hz;
    let nd = if span.is_finite() && span > 0.0 {
        (span + 1e-9).floor().max(1.0) as u64
    } else {
        1
    };
    frag.bulk_cards.push(BulkCard::Freq1 {
        sid: freq,
        f1: spec.frequency_min_hz,
        df: spec.frequency_step_hz,
        nd,
    });

    let damping = ctx.allocate(IdKind::Damping, &format!("{key_prefix}#damp"));
    frag.bulk_cards.push(BulkCard::Tabdmp1 {
        sid: damping,
        dtype: "CRIT".into(),
        flat: true,
        pairs: vec![
            (spec.frequency_min_hz, spec.damping_ratio),
            (spec.frequency_max_hz, spec.damping_ratio),
        ],
    });

    let sc = ctx.allocate(IdKind::Subcase, &format!("{key_prefix}#sub"));
    let label = label_override
        .map(ToString::to_string)
        .unwrap_or_else(|| ascii_name(&spec.name));
    ctx.metadata("LOADSTEPS", sc, format!("LS_{label}"));
    frag.subcases.push(Subcase {
        id: sc,
        label,
        analysis: Some("MFREQ".into()),
        spc: (spec.existing_spc_set_id > 0).then_some(spec.existing_spc_set_id),
        dload: spec.load_id.filter(|id| *id > 0),
        method: Some(eigrl),
        freq: Some(freq),
        sdamping: Some(damping),
        outputs: vec![
            "DISPLACEMENT = ALL".into(),
            "VELOCITY = ALL".into(),
            "ACCELERATION = ALL".into(),
        ],
        ..Default::default()
    });
}
