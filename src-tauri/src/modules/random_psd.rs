//! Random PSD response generation for OptiStruct 2022.
//!
//! Solve chain (SPEC A0.1 / §9.1):
//!   SPCD/DAREA + RLOAD1|RLOAD2 + DLOAD -> MFREQ subcase (SPC/METHOD/FREQ/SDAMPING/DLOAD)
//!   TABRND1 -> RANDPS(J=K, Y=0) -> RANDOM subcase (RANDOM=SID)
//!
//! Supported configuration (SPEC A3/A4/A5/A6, milestones M2):
//!   * modal method: EIGRL (Lanczos, default) or EIGRA (AMSES);
//!   * excitation form: RLOAD2 (amplitude/phase, default) or RLOAD1 (real/imag);
//!   * frequency distribution: FREQ1 (uniform, default), FREQ2 (log) or FREQ (list);
//!   * axis mode: single axis (default) or sequential-tri (3 independent
//!     MFREQ + 3 RANDOM pairs). Sequential-tri is explicitly *independent*, not a
//!     simultaneous correlated multi-axis random solve.
//!
//! No GRID is created; the excited node and SPC set are external references and
//! always surfaced as UNVERIFIED_EXTERNAL.

use crate::core::cards::{BulkCard, TableOrConst, Vec3};
use crate::core::diagnostics::Diagnostic;
use crate::core::case_spec::{Damping, Excitation, RandomPsdSpec};
use crate::core::deck_ir::{DeckFragment, GenerationContext, Subcase};
use crate::core::ids::IdKind;
use crate::core::psd;
use crate::core::validation::require_units;
use crate::modules::{ascii_name, BuiltCase};

fn method_is_eigra(solver: &str) -> bool {
    let s = solver.to_ascii_uppercase();
    s.contains("AMSES") || s.contains("EIGRA")
}

fn tab_axes(interpolation: &str) -> (&'static str, &'static str) {
    match interpolation {
        "LINEAR-LINEAR" => ("LINEAR", "LINEAR"),
        "LOG-LINEAR" => ("LOG", "LINEAR"),
        "LINEAR-LOG" => ("LINEAR", "LOG"),
        _ => ("LOG", "LOG"),
    }
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

/// Push the amplitude/phase (RLOAD2) or complex real/imag (RLOAD1) load card.
fn push_rload(frag: &mut DeckFragment, sid: u64, exciteid: u64, rtype: &str, form: &str) {
    if form.eq_ignore_ascii_case("RLOAD1") {
        frag.bulk_cards.push(BulkCard::Rload1 {
            sid,
            exciteid,
            delay: None,
            dphase: None,
            // Unit real input: TC=1.0 (real), TD=0.0 (imag) per SPEC A3.
            tc: TableOrConst::Constant(1.0),
            td: TableOrConst::Constant(0.0),
            rtype: rtype.into(),
        });
    } else {
        frag.bulk_cards.push(BulkCard::Rload2 {
            sid,
            exciteid,
            delay: None,
            dphase: None,
            tb: None,
            tp: None,
            rtype: rtype.into(),
        });
    }
}

fn push_modal_card(frag: &mut DeckFragment, sid: u64, spec: &RandomPsdSpec, use_eigra: bool) {
    if use_eigra {
        if let Some(e) = &spec.eigra {
            frag.bulk_cards.push(BulkCard::Eigra {
                sid,
                v1: e.v1_hz.or(Some(spec.modal.min_hz)),
                v2: e.v2_hz,
                nd: e.nd,
                msglvl: e.msglvl,
                ampffact: e.ampffact,
                norm: e.norm.clone(),
            });
            return;
        }
    }
    frag.bulk_cards.push(BulkCard::Eigrl {
        sid,
        nd: None,
        v1: Some(spec.modal.min_hz),
        v2: Some(spec.modal.max_hz),
    });
}

fn push_freq_card(frag: &mut DeckFragment, sid: u64, spec: &RandomPsdSpec, fkind: &str) {
    match fkind {
        "FREQ2" => {
            let nf = spec.frequency.nf.unwrap_or(10);
            frag.bulk_cards.push(BulkCard::Freq2 {
                sid,
                f1: spec.frequency.min_hz,
                f2: spec.frequency.max_hz,
                nf,
            });
        }
        "FREQ" => {
            let freqs = if spec.frequency.explicit_hz.is_empty() {
                vec![spec.frequency.min_hz, spec.frequency.max_hz]
            } else {
                spec.frequency.explicit_hz.clone()
            };
            frag.bulk_cards.push(BulkCard::FreqList { sid, freqs });
        }
        _ => {
            let span = (spec.frequency.max_hz - spec.frequency.min_hz) / spec.frequency.step_hz;
            let nd = (span.round() as u64).saturating_add(1).max(2);
            frag.bulk_cards.push(BulkCard::Freq1 {
                sid,
                f1: spec.frequency.min_hz,
                df: spec.frequency.step_hz,
                nd,
            });
        }
    }
}

fn random_outputs(spec: &RandomPsdSpec) -> Vec<String> {
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
    random_outputs
}

fn mfreq_outputs() -> Vec<String> {
    vec![
        "DISPLACEMENT = ALL".into(),
        "VELOCITY = ALL".into(),
        "ACCELERATION = ALL".into(),
    ]
}

fn validate_frequency(spec: &RandomPsdSpec, fkind: &str, ctx: &mut GenerationContext) {
    let f = &spec.frequency;
    match fkind {
        "FREQ2" => {
            if !(f.min_hz.is_finite() && f.min_hz > 0.0) {
                ctx.error("LC-PSD-020", "FREQ2 起始频率 F1 必须为正的有限值");
            }
            if !(f.max_hz.is_finite() && f.max_hz > f.min_hz) {
                ctx.error("LC-PSD-020", "FREQ2 终止频率 F2 必须大于 F1");
            }
            if !matches!(f.nf, Some(n) if n > 0) {
                ctx.error("LC-PSD-020", "FREQ2 对数区间数 NF 必须为正整数");
            }
        }
        "FREQ" => {
            if f.explicit_hz.len() < 2 {
                ctx.error("LC-PSD-020", "FREQ 显式频点至少需要两个");
            }
            for (i, v) in f.explicit_hz.iter().enumerate() {
                if !v.is_finite() || *v <= 0.0 {
                    ctx.error("LC-PSD-020", format!("FREQ 第 {} 个频点必须为正的有限值", i + 1));
                }
                if i > 0 && *v <= f.explicit_hz[i - 1] {
                    ctx.error("LC-PSD-020", format!("FREQ 频点必须严格递增（第 {} 点）", i + 1));
                }
            }
        }
        _ => {
            if !(f.step_hz.is_finite() && f.step_hz > 0.0) {
                ctx.error("LC-INPUT-001", "频率步长必须为正的有限值");
            }
            if !(f.max_hz.is_finite() && f.max_hz > f.min_hz) {
                ctx.error("LC-INPUT-001", "频率上限必须大于下限");
            }
        }
    }
}

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

    // --- frequency definition --------------------------------------------
    let fkind = spec.frequency.kind.trim().to_ascii_uppercase();
    if !matches!(fkind.as_str(), "FREQ1" | "FREQ2" | "FREQ") {
        ctx.error("LC-INPUT-001", "频率定义类型必须为 FREQ1 / FREQ2 / FREQ");
    }
    validate_frequency(spec, &fkind, &mut ctx);

    // --- modal truncation warning ----------------------------------------
    if spec.modal.max_hz.is_finite() && spec.modal.max_hz < spec.frequency.max_hz {
        ctx.warn(
            "LC-PSD-110",
            format!(
                "模态截断上限 {:.1} Hz 低于求解上限 {:.1} Hz，可能丢失高频响应；建议提升模态范围",
                spec.modal.max_hz, spec.frequency.max_hz
            ),
        );
    }

    // --- modal method (EIGRL vs EIGRA) -----------------------------------
    let use_eigra = method_is_eigra(&spec.modal.solver);
    if use_eigra {
        match &spec.eigra {
            Some(e) => {
                if !e.v2_hz.is_finite() || e.v2_hz <= 0.0 {
                    ctx.diagnostics.push(
                        Diagnostic::error("LC-PSD-020", "EIGRA V2（最高模态频率）必须为正的有限值")
                            .field("eigra.v2Hz"),
                    );
                }
                if let Some(v1) = e.v1_hz {
                    if !v1.is_finite() || v1 < 0.0 {
                        ctx.diagnostics.push(
                            Diagnostic::error("LC-PSD-020", "EIGRA V1 必须为非负有限值")
                                .field("eigra.v1Hz"),
                        );
                    } else if v1 >= e.v2_hz {
                        ctx.diagnostics.push(
                            Diagnostic::error("LC-PSD-020", "EIGRA 要求 V1 < V2")
                                .field("eigra.v1Hz"),
                        );
                    }
                }
                if let Some(norm) = &e.norm {
                    let n = norm.to_ascii_uppercase();
                    if !matches!(n.as_str(), "MASS" | "MAX" | "ALL") {
                        ctx.diagnostics.push(
                            Diagnostic::error("LC-PSD-020", "EIGRA NORM 只能为 MASS / MAX / ALL")
                                .field("eigra.norm"),
                        );
                    }
                }
                if let Some(af) = e.ampffact {
                    if !af.is_finite() || af <= 0.0 {
                        ctx.diagnostics.push(
                            Diagnostic::error("LC-PSD-020", "EIGRA AMPFFACT 必须为正的有限值")
                                .field("eigra.ampffact"),
                        );
                    }
                }
            }
            None => ctx.diagnostics.push(
                Diagnostic::error(
                    "LC-PSD-020",
                    "已选择 AMSES(EIGRA) 模态法，但缺少 EIGRA 参数（V2 必填）",
                )
                .field("eigra"),
            ),
        }
    }

    // --- damping ----------------------------------------------------------
    let damping_ratio = match &spec.damping {
        Damping::ModalCriticalRatio { ratio } => *ratio,
    };
    if !damping_ratio.is_finite() || damping_ratio <= 0.0 || damping_ratio >= 1.0 {
        ctx.error("LC-INPUT-001", "模态阻尼比必须在 (0,1) 区间");
    }

    // --- excitation form & axis mode -------------------------------------
    let exc_form = spec.excitation_form.trim().to_ascii_uppercase();
    if !matches!(exc_form.as_str(), "RLOAD1" | "RLOAD2") {
        ctx.diagnostics.push(
            Diagnostic::error("LC-INPUT-001", "激励形式必须为 RLOAD1 或 RLOAD2")
                .field("excitationForm"),
        );
    }
    let axis_mode = spec.axis_mode.trim().to_ascii_uppercase().replace('_', "-");
    let tri_requested = matches!(
        axis_mode.as_str(),
        "SEQUENTIAL-TRI" | "TRI" | "SEQUENTIAL-TRIAXIS"
    );
    if tri_requested && !matches!(spec.excitation, Excitation::BaseAcceleration { .. }) {
        ctx.error(
            "LC-PSD-020",
            "顺序三轴 (sequential-tri) 仅支持基座加速度激励；随机节点力请使用单轴",
        );
    }
    let tri = tri_requested && matches!(spec.excitation, Excitation::BaseAcceleration { .. });

    // --- excitation validation (shared) ----------------------------------
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
            if !tri && !(1..=3).contains(component) {
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

    // --- shared ids: method / freq / damping / table ---------------------
    let method_sid = ctx.allocate(IdKind::Method, &format!("{}#eigrl", spec.name));
    let freq_sid = ctx.allocate(IdKind::Freq, &format!("{}#freq", spec.name));
    let damp_sid = ctx.allocate(IdKind::Damping, &format!("{}#damp", spec.name));
    let table_sid = ctx.allocate(IdKind::Table, &format!("{}#tabrnd1", spec.name));

    push_modal_card(&mut frag, method_sid, spec, use_eigra);
    push_freq_card(&mut frag, freq_sid, spec, &fkind);
    frag.bulk_cards.push(BulkCard::Tabdmp1 {
        sid: damp_sid,
        xaxis: String::new(),
        yaxis: String::new(),
        pairs: vec![
            (spec.frequency.min_hz, damping_ratio),
            (spec.frequency.max_hz, damping_ratio),
        ],
    });
    let (xaxis, yaxis) = tab_axes(&spec.spectrum.interpolation);
    frag.bulk_cards.push(BulkCard::Tabrnd1 {
        sid: table_sid,
        xaxis: xaxis.into(),
        yaxis: yaxis.into(),
        points: points.clone(),
    });

    let base = ascii_name(&spec.name);
    let spc = external_spc(&spec.excitation);
    let rand_outputs = random_outputs(spec);

    if tri {
        // Three independent MFREQ + RANDOM pairs (SPEC A9 sequential-tri).
        ctx.info(
            "LC-PSD-001",
            "顺序三轴：生成 3 个 MFREQ + 3 个 RANDOM 子工况（各自独立自谱，非同时相关随机；不可宣称已完成三轴合成）",
        );
        let node_id = match &spec.excitation {
            Excitation::BaseAcceleration { node_id, .. } => *node_id,
            _ => 0,
        };
        let value = accel_unit.unwrap_or(0.0);
        for comp in [1u32, 2u32, 3u32] {
            let spcd_sid = ctx.allocate(IdKind::Spcd, &format!("{}#axis{}#spcd", spec.name, comp));
            let rload_sid = ctx.allocate(IdKind::Rload, &format!("{}#axis{}#rload", spec.name, comp));
            let dload_sid = ctx.allocate(IdKind::Dload, &format!("{}#axis{}#dload", spec.name, comp));
            let mfreq_sub = ctx.allocate(IdKind::Subcase, &format!("{}#axis{}#mfreq", spec.name, comp));
            let random_sub = ctx.allocate(IdKind::Subcase, &format!("{}#axis{}#random", spec.name, comp));
            let randps_sid = ctx.allocate(IdKind::Random, &format!("{}#axis{}#randps", spec.name, comp));

            frag.bulk_cards.push(BulkCard::Spcd {
                sid: spcd_sid,
                gid: node_id,
                component: comp,
                d: value,
            });
            push_rload(&mut frag, rload_sid, spcd_sid, "ACCE", &exc_form);
            frag.bulk_cards.push(BulkCard::Dload {
                sid: dload_sid,
                scale: 1.0,
                components: vec![(1.0, rload_sid)],
            });
            frag.bulk_cards.push(BulkCard::Randps {
                sid: randps_sid,
                j: mfreq_sub,
                k: mfreq_sub,
                x: 1.0,
                y: 0.0,
                tid: table_sid,
            });

            ctx.metadata("LOADSTEPS", mfreq_sub, format!("LS_{base}_MFREQ_{comp}"));
            ctx.metadata("LOADSTEPS", random_sub, format!("LS_{base}_RANDOM_{comp}"));
            frag.subcases.push(Subcase {
                id: mfreq_sub,
                label: format!("{base}_MFREQ_{comp}"),
                analysis: Some("MFREQ".into()),
                spc: Some(spc),
                method: Some(method_sid),
                freq: Some(freq_sid),
                sdamping: Some(damp_sid),
                dload: Some(dload_sid),
                outputs: mfreq_outputs(),
                ..Default::default()
            });
            frag.subcases.push(Subcase {
                id: random_sub,
                label: format!("{base}_RANDOM_{comp}"),
                analysis: Some("RANDOM".into()),
                random: Some(randps_sid),
                outputs: rand_outputs.clone(),
                ..Default::default()
            });
        }
    } else {
        // Single-axis. Allocation order preserved for golden determinism.
        let mfreq_sub = ctx.allocate(IdKind::Subcase, &format!("{}#mfreq", spec.name));
        let random_sub = ctx.allocate(IdKind::Subcase, &format!("{}#random", spec.name));
        let randps_sid = ctx.allocate(IdKind::Random, &format!("{}#randps", spec.name));
        let dload_sid = ctx.allocate(IdKind::Dload, &format!("{}#dload", spec.name));
        let rload_sid = ctx.allocate(IdKind::Rload, &format!("{}#rload2", spec.name));

        match &spec.excitation {
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
                push_rload(&mut frag, rload_sid, spcd_sid, "ACCE", &exc_form);
            }
            Excitation::AppliedForce {
                node_id,
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
                push_rload(&mut frag, rload_sid, darea_sid, "LOAD", &exc_form);
            }
        }

        frag.bulk_cards.push(BulkCard::Dload {
            sid: dload_sid,
            scale: 1.0,
            components: vec![(1.0, rload_sid)],
        });
        frag.bulk_cards.push(BulkCard::Randps {
            sid: randps_sid,
            j: mfreq_sub,
            k: mfreq_sub,
            x: 1.0,
            y: 0.0,
            tid: table_sid,
        });

        ctx.metadata("LOADSTEPS", mfreq_sub, format!("LS_{base}_MFREQ"));
        ctx.metadata("LOADSTEPS", random_sub, format!("LS_{base}_RANDOM"));
        frag.subcases.push(Subcase {
            id: mfreq_sub,
            label: format!("{base}_MFREQ"),
            analysis: Some("MFREQ".into()),
            spc: Some(spc),
            method: Some(method_sid),
            freq: Some(freq_sid),
            sdamping: Some(damp_sid),
            dload: Some(dload_sid),
            outputs: mfreq_outputs(),
            ..Default::default()
        });
        frag.subcases.push(Subcase {
            id: random_sub,
            label: format!("{base}_RANDOM"),
            analysis: Some("RANDOM".into()),
            random: Some(randps_sid),
            outputs: rand_outputs,
            ..Default::default()
        });
    }

    BuiltCase::new(frag, ctx)
}
