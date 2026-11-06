//! Single-input, auto-spectrum, single-axis random PSD response (V1 scope).
//!
//! Solve chain (SPEC §9.1):
//!   SPCD/DAREA + RLOAD2 + DLOAD → MFREQ subcase (SPC/METHOD/FREQ/SDAMPING/DLOAD)
//!   TABRND1 → RANDPS(J=K, Y=0) → RANDOM subcase (RANDOM=SID).
//!
//! No GRID is created; the excited node and SPC set are external references and
//! always surfaced as UNVERIFIED_EXTERNAL.

use crate::core::cards::{BulkCard, Vec3};
use crate::core::case_spec::{Damping, Excitation, RandomPsdSpec};
use crate::core::deck_ir::{DeckFragment, GenerationContext, Subcase};
use crate::core::ids::IdKind;
use crate::core::psd;
use crate::core::units::UnitSystem;
use crate::core::validation::require_units;
use crate::modules::{ascii_name, BuiltCase};

pub fn generate(spec: &RandomPsdSpec) -> BuiltCase {
    let mut ctx = GenerationContext::new(
        &spec.solver,
        &spec.solver_version,
        &spec.model_units,
        spec.id_policy.clone(),
    );
    let mut frag = DeckFragment::new(111);

    let units = match require_units(&spec.model_units) {
        Ok(u) => Some(u),
        Err(d) => {
            ctx.diagnostics.push(d);
            None
        }
    };

    // --- spectrum ---------------------------------------------------------
    let points: Vec<(f64, f64)> = spec
        .spectrum
        .points
        .iter()
        .map(|p| (p.frequency_hz, p.psd))
        .collect();
    for diag in psd::validate_spectrum(&points, &spec.spectrum.interpolation) {
        ctx.diagnostics.push(diag);
    }
    for diag in psd::check_coverage(
        &points,
        (spec.frequency.min_hz, spec.frequency.max_hz),
        &spec.spectrum.out_of_range,
    ) {
        ctx.diagnostics.push(diag);
    }

    // --- frequency & modal ------------------------------------------------
    if !(spec.frequency.step_hz.is_finite() && spec.frequency.step_hz > 0.0) {
        ctx.error("LC-INPUT-001", "频率步长必须为正的有限值");
    }
    if !(spec.frequency.max_hz.is_finite() && spec.frequency.max_hz > spec.frequency.min_hz) {
        ctx.error("LC-INPUT-001", "频率上限必须大于下限");
    }
    if spec.modal.max_hz.is_finite() && spec.modal.max_hz < spec.frequency.max_hz {
        ctx.warn(
            "LC-PSD-001",
            format!(
                "模态截断上限 {:.1} Hz 低于求解上限 {:.1} Hz，可能丢失高频响应；建议提升模态范围",
                spec.modal.max_hz, spec.frequency.max_hz
            ),
        );
    }

    // --- damping ----------------------------------------------------------
    let damping_ratio = match &spec.damping {
        Damping::ModalCriticalRatio { ratio } => *ratio,
    };
    if !damping_ratio.is_finite() || damping_ratio <= 0.0 || damping_ratio >= 1.0 {
        ctx.error("LC-INPUT-001", "模态阻尼比必须在 (0,1) 区间");
    }

    // --- excitation -------------------------------------------------------
    let mut accel_unit: Option<f64> = None;
    match &spec.excitation {
        Excitation::BaseAcceleration {
            node_id,
            component,
            existing_spc_set_id,
            reference_amplitude_g,
            ..
        } => {
            if *node_id == 0 {
                ctx.error("LC-INPUT-001", "被激励节点号必须为正整数");
            }
            if !(1..=3).contains(component) {
                ctx.error("LC-INPUT-001", "基座加速度分量必须为 1/2/3（平动 X/Y/Z）");
            }
            if !spec.confirm_excited_dof_in_spc {
                ctx.diagnostics.push(
                    crate::core::diagnostics::Diagnostic::error(
                        "LC-REF-001",
                        "必须确认被激励节点的指定自由度包含在 SPC 集合中，且不是 RBE2 依赖自由度",
                    )
                    .field("confirmExcitedDofInSpc"),
                );
            }
            ctx.note_external(
                IdKind::Spc,
                *existing_spc_set_id,
                Some("existing SPC set".into()),
                "random-psd",
            );
            ctx.note_external(
                IdKind::Node,
                *node_id,
                Some("excitation node".into()),
                "random-psd",
            );
            if let Some(u) = units {
                accel_unit = Some(reference_amplitude_g * u.gravity());
            }
        }
        Excitation::AppliedForce {
            node_id,
            direction,
            existing_spc_set_id,
            reference_force_n,
            ..
        } => {
            if *node_id == 0 {
                ctx.error("LC-INPUT-001", "被激励节点号必须为正整数");
            }
            if Vec3::new(direction[0], direction[1], direction[2])
                .normalized()
                .is_none()
            {
                ctx.error("LC-INPUT-001", "随机力方向向量不能为零");
            }
            if !spec.confirm_excited_dof_in_spc {
                ctx.diagnostics.push(
                    crate::core::diagnostics::Diagnostic::error(
                        "LC-REF-001",
                        "必须确认被激励节点的自由度受约束关系覆盖",
                    )
                    .field("confirmExcitedDofInSpc"),
                );
            }
            ctx.note_external(
                IdKind::Spc,
                *existing_spc_set_id,
                Some("existing SPC set".into()),
                "random-psd",
            );
            ctx.note_external(
                IdKind::Node,
                *node_id,
                Some("excitation node".into()),
                "random-psd",
            );
            if !reference_force_n.is_finite() || *reference_force_n <= 0.0 {
                ctx.error("LC-INPUT-001", "参考力幅值必须为正的有限值");
            }
        }
    }

    // --- Grms summary -----------------------------------------------------
    if let Ok(area) = psd::integrate_psd(&points, &spec.spectrum.interpolation) {
        let rms = area.max(0.0).sqrt();
        let unit = match &spec.excitation {
            Excitation::BaseAcceleration { .. } => "g",
            Excitation::AppliedForce { .. } => "N",
        };
        ctx.info(
            "LC-PSD-001",
            format!(
                "输入谱积分 {unit} RMS = {rms:.6}（{} 插值，{} 点）",
                spec.spectrum.interpolation,
                points.len()
            ),
        );
    }

    // --- allocate ids (deterministic order) -------------------------------
    let method_sid = ctx.allocate(IdKind::Method, &format!("{}#eigrl", spec.name));
    let freq_sid = ctx.allocate(IdKind::Freq, &format!("{}#freq", spec.name));
    let damp_sid = ctx.allocate(IdKind::Damping, &format!("{}#damp", spec.name));
    let table_sid = ctx.allocate(IdKind::Table, &format!("{}#tabrnd1", spec.name));
    let mfreq_sub = ctx.allocate(IdKind::Subcase, &format!("{}#mfreq", spec.name));
    let random_sub = ctx.allocate(IdKind::Subcase, &format!("{}#random", spec.name));
    let randps_sid = ctx.allocate(IdKind::Random, &format!("{}#randps", spec.name));
    let dload_sid = ctx.allocate(IdKind::Dload, &format!("{}#dload", spec.name));
    let rload_sid = ctx.allocate(IdKind::Rload, &format!("{}#rload2", spec.name));

    // --- modal / frequency / damping cards --------------------------------
    frag.bulk_cards.push(BulkCard::Eigrl {
        sid: method_sid,
        nd: None,
        v1: Some(spec.modal.min_hz),
        v2: Some(spec.modal.max_hz),
    });
    let span = (spec.frequency.max_hz - spec.frequency.min_hz) / spec.frequency.step_hz;
    let nd = (span.round() as u64).saturating_add(1).max(2);
    frag.bulk_cards.push(BulkCard::Freq1 {
        sid: freq_sid,
        f1: spec.frequency.min_hz,
        df: spec.frequency.step_hz,
        nd,
    });
    frag.bulk_cards.push(BulkCard::Tabdmp1 {
        sid: damp_sid,
        xaxis: String::new(),
        yaxis: String::new(),
        pairs: vec![
            (spec.frequency.min_hz, damping_ratio),
            (spec.frequency.max_hz, damping_ratio),
        ],
    });

    // --- TABRND1 ----------------------------------------------------------
    let (xaxis, yaxis) = tab_axes(&spec.spectrum.interpolation);
    frag.bulk_cards.push(BulkCard::Tabrnd1 {
        sid: table_sid,
        xaxis: xaxis.into(),
        yaxis: yaxis.into(),
        points: points.clone(),
    });

    // --- excitation cards -------------------------------------------------
    let exciteid = match &spec.excitation {
        Excitation::BaseAcceleration {
            node_id, component, ..
        } => {
            let spcd_sid = ctx.allocate(IdKind::Spcd, &format!("{}#spcd", spec.name));
            let value = accel_unit.unwrap_or(0.0);
            frag.bulk_cards.push(BulkCard::Spcd {
                sid: spcd_sid,
                gid: *node_id,
                component: *component,
                d: value,
            });
            frag.bulk_cards.push(BulkCard::Rload2 {
                sid: rload_sid,
                exciteid: spcd_sid,
                delay: None,
                dphase: None,
                tb: None,
                tp: None,
                rtype: "ACCE".into(),
            });
            spcd_sid
        }
        Excitation::AppliedForce {
            node_id,
            cid,
            direction,
            reference_force_n,
            ..
        } => {
            let darea_sid = ctx.allocate(IdKind::Darea, &format!("{}#darea", spec.name));
            let dir = Vec3::new(direction[0], direction[1], direction[2])
                .normalized()
                .unwrap_or(Vec3::new(1.0, 0.0, 0.0));
            for (component, comp) in [(1u32, dir.x), (2u32, dir.y), (3u32, dir.z)] {
                if comp != 0.0 {
                    frag.bulk_cards.push(BulkCard::Darea {
                        sid: darea_sid,
                        gid: *node_id,
                        component,
                        a: reference_force_n * comp,
                    });
                }
            }
            let _ = cid;
            frag.bulk_cards.push(BulkCard::Rload2 {
                sid: rload_sid,
                exciteid: darea_sid,
                delay: None,
                dphase: None,
                tb: None,
                tp: None,
                rtype: "LOAD".into(),
            });
            darea_sid
        }
    };
    let _ = exciteid;
    frag.bulk_cards.push(BulkCard::Dload {
        sid: dload_sid,
        scale: 1.0,
        components: vec![(1.0, rload_sid)],
    });

    // --- RANDPS: J = K = MFREQ subcase, Y = 0 (auto-spectrum) -------------
    frag.bulk_cards.push(BulkCard::Randps {
        sid: randps_sid,
        j: mfreq_sub,
        k: mfreq_sub,
        x: 1.0,
        y: 0.0,
        tid: table_sid,
    });

    // --- subcases ---------------------------------------------------------
    let base = ascii_name(&spec.name);
    ctx.metadata("LOADSTEPS", mfreq_sub, format!("LS_{base}_MFREQ"));
    ctx.metadata("LOADSTEPS", random_sub, format!("LS_{base}_RANDOM"));
    frag.subcases.push(Subcase {
        id: mfreq_sub,
        label: format!("{base}_MFREQ"),
        analysis: Some("MFREQ".into()),
        spc: Some(external_spc(&spec.excitation)),
        method: Some(method_sid),
        freq: Some(freq_sid),
        sdamping: Some(damp_sid),
        dload: Some(dload_sid),
        outputs: vec![
            "DISPLACEMENT = ALL".into(),
            "VELOCITY = ALL".into(),
            "ACCELERATION = ALL".into(),
        ],
        ..Default::default()
    });
    let output = spec.output();
    let flag = if output.profile == "RMS_ONLY" {
        "RMS"
    } else {
        "PSDF"
    };
    let mut random_outputs: Vec<String> = Vec::new();
    if output.displacement {
        random_outputs.push(format!("DISPLACEMENT(SORT1,{flag})=ALL"));
    }
    if output.stress {
        random_outputs.push(format!("STRESS(SORT1,{flag})=ALL"));
    }
    if output.acceleration {
        random_outputs.push(format!("ACCELERATION(SORT1,{flag})=ALL"));
    }
    if random_outputs.is_empty() {
        random_outputs.push(format!("DISPLACEMENT(SORT1,{flag})=ALL"));
    }
    frag.subcases.push(Subcase {
        id: random_sub,
        label: format!("{base}_RANDOM"),
        analysis: Some("RANDOM".into()),
        random: Some(randps_sid),
        outputs: random_outputs,
        ..Default::default()
    });

    let _ = UnitSystem::NmmS;

    BuiltCase::new(frag, ctx)
}

fn external_spc(excitation: &Excitation) -> u64 {
    match excitation {
        Excitation::BaseAcceleration {
            existing_spc_set_id,
            ..
        } => *existing_spc_set_id,
        Excitation::AppliedForce {
            existing_spc_set_id,
            ..
        } => *existing_spc_set_id,
    }
}

fn tab_axes(interpolation: &str) -> (&'static str, &'static str) {
    match interpolation {
        "LINEAR-LINEAR" => ("LINEAR", "LINEAR"),
        "LOG-LINEAR" => ("LOG", "LINEAR"),
        "LINEAR-LOG" => ("LINEAR", "LOG"),
        _ => ("LOG", "LOG"),
    }
}
