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

    if let Err(d) = require_units(&spec.model_units) {
        ctx.diagnostics.push(d);
    }
    if !(spec.frequency_step_hz.is_finite() && spec.frequency_step_hz > 0.0) {
        ctx.error("LC-INPUT-001", "频率步长必须为正的有限值");
    }
    if spec.frequency_max_hz <= spec.frequency_min_hz {
        ctx.error("LC-INPUT-001", "频率上限必须大于下限");
    }
    ctx.note_external(
        IdKind::Spc,
        spec.existing_spc_set_id,
        Some("existing SPC set".into()),
        "frequency-response",
    );
    if let Some(load) = spec.load_id {
        ctx.note_external(
            IdKind::Load,
            load,
            Some("existing load".into()),
            "frequency-response",
        );
    }

    let eigrl = ctx.allocate(IdKind::Method, &format!("{}#eigrl", spec.name));
    frag.bulk_cards.push(BulkCard::Eigrl {
        sid: eigrl,
        nd: None,
        v1: Some(spec.eigrl_min_hz),
        v2: Some(spec.eigrl_max_hz),
    });

    let freq = ctx.allocate(IdKind::Freq, &format!("{}#freq", spec.name));
    let span = (spec.frequency_max_hz - spec.frequency_min_hz) / spec.frequency_step_hz;
    let nd = span.round() as u64 + 1;
    frag.bulk_cards.push(BulkCard::Freq1 {
        sid: freq,
        f1: spec.frequency_min_hz,
        df: spec.frequency_step_hz,
        nd: nd.max(2),
    });

    let damping = ctx.allocate(IdKind::Damping, &format!("{}#damp", spec.name));
    frag.bulk_cards.push(BulkCard::Tabdmp1 {
        sid: damping,
        xaxis: String::new(),
        yaxis: String::new(),
        pairs: vec![
            (spec.frequency_min_hz, spec.damping_ratio),
            (spec.frequency_max_hz, spec.damping_ratio),
        ],
    });

    let sc = ctx.allocate(IdKind::Subcase, &format!("{}#sub", spec.name));
    let label = ascii_name(&spec.name);
    ctx.metadata("LOADSTEPS", sc, format!("LS_{label}"));
    frag.subcases.push(Subcase {
        id: sc,
        label,
        analysis: Some("MFREQ".into()),
        spc: Some(spec.existing_spc_set_id),
        load: spec.load_id,
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

    BuiltCase::new(frag, ctx)
}
