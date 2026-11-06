//! Radioss ROPS (controlled imposed displacement) incremental case generator.
//!
//! Produces a typed RadiossDeck: Engine cards (single stage, run number 1) plus
//! Starter cards that reference existing nodes only. No /NODE is ever emitted.
//!
//! The generator never trusts that an external id exists: every node / group /
//! skew / part-group the user supplies is recorded as UNVERIFIED_EXTERNAL.

use std::collections::BTreeMap;

use crate::core::diagnostics::Diagnostic;
use crate::core::radioss_deck::{
    EngineCard, RadIdKind, RadiossBuilt, RadiossDeck, RadiossExternalRef, RadiossIdAllocator,
    StarterCard,
};
use crate::core::radioss_spec::{
    RadiossConstraintTarget, RadiossLoadTarget, RadiossRopsSpec, RadiossTimeStep, UnitTriple,
};
use crate::solvers::radioss::capabilities_2022::ensure_supported;

const MASS_UNITS: &[&str] = &["kg", "g", "t", "tonne"];
const LENGTH_UNITS: &[&str] = &["m", "mm", "cm"];
const TIME_UNITS: &[&str] = &["s", "ms"];

fn err(code: &str, message: impl Into<String>) -> Diagnostic {
    Diagnostic::error(code, message)
}
fn warn(code: &str, message: impl Into<String>) -> Diagnostic {
    Diagnostic::warning(code, message)
}

/// ASCII-safe file stem derived from a run name (Chinese never enters the .rad).
pub fn ascii_stem(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "CASE".into()
    } else {
        trimmed.chars().take(48).collect()
    }
}

fn run_name_is_valid(name: &str) -> bool {
    let len = name.chars().count();
    (4..=80).contains(&len)
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

fn axis_index(direction: &str) -> Option<usize> {
    match direction.trim().to_ascii_uppercase().as_str() {
        "X" => Some(0),
        "Y" => Some(1),
        "Z" => Some(2),
        _ => None,
    }
}

fn unit_ok(triple: &UnitTriple) -> bool {
    MASS_UNITS.contains(&triple.mass.trim().to_ascii_lowercase().as_str())
        && LENGTH_UNITS.contains(&triple.length.trim().to_ascii_lowercase().as_str())
        && TIME_UNITS.contains(&triple.time.trim().to_ascii_lowercase().as_str())
}

fn same_units(a: &UnitTriple, b: &UnitTriple) -> bool {
    a.mass.trim().eq_ignore_ascii_case(b.mass.trim())
        && a.length.trim().eq_ignore_ascii_case(b.length.trim())
        && a.time.trim().eq_ignore_ascii_case(b.time.trim())
}

struct ConstraintDesc {
    nodes: Vec<u64>,
    existing_grnod: Option<u64>,
    dofs: [bool; 6],
    skew_id: u64,
}

pub fn generate(spec: &RadiossRopsSpec) -> RadiossBuilt {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();

    // ---- capability gate -------------------------------------------------
    if let Err(d) = ensure_supported(&spec.solver, &spec.solver_version) {
        diagnostics.push(d);
    }

    // ---- names -----------------------------------------------------------
    if spec.name.trim().is_empty() {
        diagnostics.push(err("LC-INPUT-001", "工况名称不能为空").field("name"));
    }
    let run_name = if run_name_is_valid(&spec.run_name) {
        spec.run_name.clone()
    } else {
        diagnostics.push(
            err(
                "LC-INPUT-001",
                "Run Name 必须是 4–80 个 ASCII 字母/数字/下划线/点/连字符，禁止 / # 换行等关键字注入字符",
            )
            .field("runName"),
        );
        ascii_stem(&spec.run_name)
    };

    // ---- units -----------------------------------------------------------
    let units = &spec.units;
    if !unit_ok(&units.input) {
        diagnostics.push(
            err("LC-UNIT-001", "输入单位必须是受支持的质量/长度/时间组合（如 kg-mm-ms）")
                .field("units.input")
                .hint("支持质量 kg/g/t/tonne，长度 m/mm/cm，时间 s/ms"),
        );
    }
    if !unit_ok(&units.work) {
        diagnostics.push(
            err("LC-UNIT-001", "工作单位必须是受支持的质量/长度/时间组合").field("units.work"),
        );
    }
    if !same_units(&units.input, &units.work) {
        diagnostics.push(
            err(
                "LC-UNIT-001",
                "v1 要求输入单位与工作单位一致；不同单位换算未经 Radioss Engine 实测，禁止自动换算",
            )
            .field("units")
            .hint("如确需不同单位，请先在 P0 验证 Engine 数值正确后再作为高级配置开放"),
        );
    }
    if !units.confirmed_against_target_model {
        diagnostics.push(
            err(
                "LC-UNIT-001",
                "必须勾选“已确认目标 HyperMesh 模型单位一致”，否则无法保证量纲正确",
            )
            .field("units.confirmedAgainstTargetModel"),
        );
    }

    // ---- load target -----------------------------------------------------
    let (load_node_ids, load_existing_grnod): (Vec<u64>, Option<u64>) =
        match &spec.references.load_target {
            RadiossLoadTarget::Node { node_id } => {
                if *node_id == 0 {
                    diagnostics.push(
                        err("LC-INPUT-001", "加载节点号必须为正整数").field("references.loadTarget"),
                    );
                }
                (vec![*node_id], None)
            }
            RadiossLoadTarget::Grnod { grnod_id } => {
                if *grnod_id == 0 {
                    diagnostics.push(
                        err("LC-REF-001", "已有节点组 ID 必须为正整数")
                            .field("references.loadTarget"),
                    );
                }
                (Vec::new(), Some(*grnod_id))
            }
        };

    // ---- direction -------------------------------------------------------
    let axis = match axis_index(&spec.loading.direction) {
        Some(a) => Some(a),
        None => {
            diagnostics.push(
                err("LC-INPUT-001", "加载方向必须是全局 X / Y / Z")
                    .field("loading.direction"),
            );
            None
        }
    };
    let direction = spec.loading.direction.trim().to_ascii_uppercase();
    let direction = if matches!(direction.as_str(), "X" | "Y" | "Z") {
        direction
    } else {
        "X".to_string()
    };

    // ---- curve semantics -------------------------------------------------
    if spec.loading.curve.len() < 2 {
        diagnostics.push(
            err("LC-CURVE-001", "位移曲线至少需要两个时间点").field("loading.curve"),
        );
    }
    let mut points: Vec<(f64, f64)> = Vec::with_capacity(spec.loading.curve.len());
    for (i, p) in spec.loading.curve.iter().enumerate() {
        if !p.time.is_finite() || !p.value.is_finite() {
            diagnostics.push(
                err("LC-CURVE-001", format!("曲线第 {} 点包含 NaN/Inf", i + 1))
                    .field(format!("loading.curve[{i}]")),
            );
        }
        if i > 0 {
            let prev = spec.loading.curve[i - 1].time;
            if p.time.is_finite() && prev.is_finite() && p.time <= prev {
                diagnostics.push(
                    err(
                        "LC-CURVE-001",
                        format!("曲线时间必须严格递增：第 {} 点 {} 不大于前一点 {}", i + 1, p.time, prev),
                    )
                    .field(format!("loading.curve[{i}].time")),
                );
            }
        }
        points.push((p.time, p.value));
    }

    // ---- engine ----------------------------------------------------------
    let eng = &spec.engine;
    if !eng.end_time.is_finite() || eng.end_time <= 0.0 {
        diagnostics.push(
            err("LC-INPUT-001", "终止时间必须为正的有限值").field("engine.endTime"),
        );
    }
    if !eng.animation.start_time.is_finite() || eng.animation.start_time < 0.0 {
        diagnostics.push(
            err("LC-INPUT-001", "动画起始时间必须为非负有限值")
                .field("engine.animation.startTime"),
        );
    }
    if !eng.animation.interval.is_finite() || eng.animation.interval <= 0.0 {
        diagnostics.push(
            err("LC-INPUT-001", "动画输出间隔必须为正的有限值")
                .field("engine.animation.interval"),
        );
    }
    if !eng.time_history_interval.is_finite() || eng.time_history_interval <= 0.0 {
        diagnostics.push(
            err("LC-INPUT-001", "时程输出间隔必须为正的有限值")
                .field("engine.timeHistoryInterval"),
        );
    }
    if eng.animation.start_time >= eng.end_time && eng.end_time > 0.0 {
        diagnostics.push(
            err("LC-INPUT-001", "动画起始时间必须早于终止时间").field("engine.animation"),
        );
    }
    if let Some(last) = points.last() {
        if last.0.is_finite() && eng.end_time.is_finite() && last.0 < eng.end_time {
            diagnostics.push(
                warn(
                    "LC-CURVE-001",
                    format!(
                        "曲线末点时间 {} 早于运行终止时间 {}；区间外将按末两点斜率线性外推，请确认",
                        last.0, eng.end_time
                    ),
                )
                .field("loading.curve"),
            );
        }
    }
    if let Some(t_start) = spec.loading.t_start {
        if !t_start.is_finite() || t_start < 0.0 {
            diagnostics.push(
                err("LC-INPUT-001", "IMPDISP 起始时间必须为非负有限值").field("loading.tStart"),
            );
        }
    }
    if let (Some(a), Some(b)) = (spec.loading.t_start, spec.loading.t_stop) {
        if b <= a {
            diagnostics.push(
                err("LC-INPUT-001", "IMPDISP 停止时间必须大于起始时间").field("loading.tStop"),
            );
        }
    }

    // ---- time step strategy ---------------------------------------------
    match &eng.time_step {
        RadiossTimeStep::Natural => {}
        RadiossTimeStep::NodaCst { scale, target } => {
            if !scale.is_finite() || *scale <= 0.0 {
                diagnostics.push(
                    err("LC-INPUT-001", "时间步缩放系数必须为正的有限值")
                        .field("engine.timeStep.scale"),
                );
            }
            if !target.is_finite() || *target <= 0.0 {
                diagnostics.push(
                    err("LC-INPUT-001", "目标最小时间步必须为正的有限值")
                        .field("engine.timeStep.target"),
                );
            }
        }
        RadiossTimeStep::Ams {
            scale,
            target,
            ams_part_group_id,
        } => {
            if !scale.is_finite() || *scale <= 0.0 {
                diagnostics.push(
                    err("LC-INPUT-001", "AMS 时间步缩放系数必须为正的有限值")
                        .field("engine.timeStep.scale"),
                );
            }
            if !target.is_finite() || *target <= 0.0 {
                diagnostics.push(
                    err("LC-INPUT-001", "AMS 目标最小时间步必须为正的有限值")
                        .field("engine.timeStep.target"),
                );
            }
            if ams_part_group_id.is_none() {
                diagnostics.push(
                    warn(
                        "LC-INPUT-001",
                        "未指定 AMS 作用 part group：/AMS 将作用于全模型，请确认这是工程意图",
                    )
                    .field("engine.timeStep.amsPartGroupId"),
                );
            }
        }
    }

    // ---- constraints -----------------------------------------------------
    let mut constraints: Vec<ConstraintDesc> = Vec::new();
    for (i, c) in spec.references.constraints.iter().enumerate() {
        let (nodes, existing) = match &c.target {
            RadiossConstraintTarget::Nodes { node_ids } => {
                if node_ids.is_empty() {
                    diagnostics.push(
                        err("LC-INPUT-001", format!("第 {} 个约束的节点列表为空", i + 1))
                            .field(format!("references.constraints[{i}]")),
                    );
                }
                if node_ids.iter().any(|n| *n == 0) {
                    diagnostics.push(
                        err("LC-INPUT-001", format!("第 {} 个约束包含非法节点号 0", i + 1))
                            .field(format!("references.constraints[{i}]")),
                    );
                }
                (node_ids.clone(), None)
            }
            RadiossConstraintTarget::Grnod { grnod_id } => {
                if *grnod_id == 0 {
                    diagnostics.push(
                        err("LC-REF-001", format!("第 {} 个约束的节点组 ID 非法", i + 1))
                            .field(format!("references.constraints[{i}]")),
                    );
                }
                (Vec::new(), Some(*grnod_id))
            }
        };
        if !c.dofs.iter().any(|d| *d) {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个约束至少固定一个自由度", i + 1))
                    .field(format!("references.constraints[{i}].dofs")),
            );
        }
        constraints.push(ConstraintDesc {
            nodes,
            existing_grnod: existing,
            dofs: c.dofs,
            skew_id: c.skew_id.unwrap_or(0),
        });
    }
    if constraints.is_empty() {
        diagnostics.push(
            warn("LC-REF-001", "未定义任何约束节点组：模型可能存在刚体运动")
                .field("references.constraints"),
        );
    }

    // ---- load/constraint DOF conflict ------------------------------------
    if let (Some(lg), Some(axis)) = (load_existing_grnod, axis) {
        for (i, c) in constraints.iter().enumerate() {
            if c.existing_grnod == Some(lg) && c.dofs[axis] {
                diagnostics.push(
                    err(
                        "LC-CONFLICT-001",
                        format!(
                            "加载节点组 {} 的第 {} 个约束同时固定了加载方向自由度，IMPDISP 与 BCS 冲突",
                            lg,
                            i + 1
                        ),
                    )
                    .field(format!("references.constraints[{i}].dofs")),
                );
            }
        }
    }

    // ---- gravity ---------------------------------------------------------
    let mut gravity_enabled = false;
    let mut gravity_magnitude = 0.0_f64;
    let mut gravity_direction = "Z".to_string();
    if let Some(g) = &spec.gravity {
        if g.enabled {
            gravity_enabled = true;
            gravity_magnitude = g.magnitude;
            if !g.magnitude.is_finite() || g.magnitude == 0.0 {
                diagnostics.push(
                    err("LC-INPUT-001", "重力幅值必须为非零有限值（工作单位下的加速度）")
                        .field("gravity.magnitude"),
                );
            }
            if axis_index(&g.direction).is_none() {
                diagnostics.push(
                    err("LC-INPUT-001", "重力方向必须为 X / Y / Z").field("gravity.direction"),
                );
            } else {
                gravity_direction = g.direction.trim().to_ascii_uppercase();
            }
        }
    }

    // ---- allocate ids ----------------------------------------------------
    let policy = &spec.id_policy;
    let mut alloc = RadiossIdAllocator::new(policy.generated_start, &policy.manually_occupied_ranges);

    let load_group_id = match load_existing_grnod {
        Some(id) => id,
        None => alloc.allocate(RadIdKind::Grnod, "load#grnod"),
    };
    let mut constraint_group_ids: Vec<u64> = Vec::with_capacity(constraints.len());
    for (i, c) in constraints.iter().enumerate() {
        let id = match c.existing_grnod {
            Some(id) => id,
            None => alloc.allocate(RadIdKind::Grnod, &format!("constraint#{i}#grnod")),
        };
        constraint_group_ids.push(id);
    }
    let funct_id = alloc.allocate(RadIdKind::Funct, "load#funct");
    let impdisp_id = alloc.allocate(RadIdKind::Impdisp, "load#impdisp");
    let bcs_ids: Vec<u64> = constraints
        .iter()
        .enumerate()
        .map(|(i, _)| alloc.allocate(RadIdKind::Bcs, &format!("constraint#{i}#bcs")))
        .collect();
    let grav_id = if gravity_enabled {
        Some(alloc.allocate(RadIdKind::Grav, "gravity#grav"))
    } else {
        None
    };

    // ---- external reference ledger --------------------------------------
    let mut external: Vec<RadiossExternalRef> = Vec::new();
    let mut note = |kind: &str, id: u64, label: Option<String>, used_by: &str| {
        if !external
            .iter()
            .any(|r| r.kind == kind && r.id == id && r.used_by == used_by)
        {
            external.push(RadiossExternalRef::new(kind, id, label, used_by));
        }
    };
    for id in &load_node_ids {
        note("node", *id, Some("load node".into()), "radioss-rops");
    }
    if let Some(id) = load_existing_grnod {
        note("grnod", id, Some("existing load group".into()), "radioss-rops");
    }
    for (i, c) in constraints.iter().enumerate() {
        for id in &c.nodes {
            note("node", *id, Some(format!("constraint {}", i + 1)), "radioss-rops");
        }
        if let Some(id) = c.existing_grnod {
            note("grnod", id, Some(format!("constraint {}", i + 1)), "radioss-rops");
        }
        if c.skew_id != 0 {
            note("skew", c.skew_id, None, "radioss-rops");
        }
    }
    if let Some(id) = spec.loading.skew_id {
        if id != 0 {
            note("skew", id, Some("load skew".into()), "radioss-rops");
        }
    }
    if let RadiossTimeStep::Ams {
        ams_part_group_id: Some(id),
        ..
    } = &eng.time_step
    {
        note("grpart", *id, Some("AMS part group".into()), "radioss-rops");
    }

    // ---- build deck ------------------------------------------------------
    let mut deck = RadiossDeck::default();

    deck.engine.push(EngineCard::Run {
        name: run_name.clone(),
        number: 1,
        t_stop: eng.end_time,
    });
    deck.engine.push(EngineCard::AnimationDt {
        t_start: eng.animation.start_time,
        t_freq: eng.animation.interval,
    });
    deck.engine.push(EngineCard::TimeHistory {
        interval: eng.time_history_interval,
    });
    match &eng.time_step {
        RadiossTimeStep::Natural => {}
        RadiossTimeStep::NodaCst { scale, target } => deck.engine.push(EngineCard::NodalCst {
            scale: *scale,
            min_step: *target,
        }),
        RadiossTimeStep::Ams { scale, target, .. } => deck.engine.push(EngineCard::AmsDt {
            scale: *scale,
            min_step: *target,
        }),
    }

    let title = ascii_stem(&spec.name);
    if load_existing_grnod.is_none() {
        deck.starter.push(StarterCard::NodeGroup {
            id: load_group_id,
            title: format!("{title}_LOAD"),
            node_ids: load_node_ids.clone(),
        });
    }
    for (i, c) in constraints.iter().enumerate() {
        if c.existing_grnod.is_none() {
            deck.starter.push(StarterCard::NodeGroup {
                id: constraint_group_ids[i],
                title: format!("{title}_BCS_{}", i + 1),
                node_ids: c.nodes.clone(),
            });
        }
    }
    deck.starter.push(StarterCard::Function {
        id: funct_id,
        title: format!("{title}_DISP"),
        points: points.clone(),
    });
    deck.starter.push(StarterCard::ImposedDisplacement {
        id: impdisp_id,
        title: format!("{title}_IMPDISP"),
        function_id: funct_id,
        direction: direction.clone(),
        skew_id: spec.loading.skew_id.unwrap_or(0),
        sensor_id: 0,
        group_id: load_group_id,
        icoor: 0,
        a_scale: 1.0,
        f_scale: 1.0,
        t_start: spec.loading.t_start,
        t_stop: spec.loading.t_stop,
    });
    for (i, c) in constraints.iter().enumerate() {
        deck.starter.push(StarterCard::Boundary {
            id: bcs_ids[i],
            title: format!("{title}_BCS_{}", i + 1),
            dofs: c.dofs,
            skew_id: c.skew_id,
            group_id: constraint_group_ids[i],
        });
    }
    if let (true, Some(gid)) = (gravity_enabled, grav_id) {
        deck.starter.push(StarterCard::Gravity {
            id: gid,
            title: format!("{title}_GRAV"),
            function_id: 0,
            direction: gravity_direction,
            skew_id: 0,
            sensor_id: 0,
            group_id: 0,
            a_scale: 1.0,
            f_scale: gravity_magnitude,
        });
    }
    if let RadiossTimeStep::Ams {
        ams_part_group_id, ..
    } = &eng.time_step
    {
        deck.starter.push(StarterCard::Ams {
            part_group_id: ams_part_group_id.unwrap_or(0),
        });
    }

    // ---- card counts -----------------------------------------------------
    let mut card_counts: BTreeMap<String, usize> = BTreeMap::new();
    for card in &deck.engine {
        *card_counts.entry(card.keyword().to_string()).or_default() += 1;
    }
    for card in &deck.starter {
        *card_counts.entry(card.keyword().to_string()).or_default() += 1;
    }

    let id_plan = alloc.assignments();
    RadiossBuilt {
        deck,
        diagnostics,
        external,
        id_plan,
        card_counts,
    }
}
