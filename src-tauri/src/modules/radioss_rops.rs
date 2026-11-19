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
    RadiossConstraintTarget, RadiossCurvePoint, RadiossGravity, RadiossLoadTarget,
    RadiossRopsSpec, RadiossTimeStep, UnitTriple,
};
use crate::solvers::radioss::capabilities_2022::ensure_supported;

const MASS_UNITS: &[&str] = &["kg", "g", "t", "tonne"];
const LENGTH_UNITS: &[&str] = &["m", "mm", "cm"];
const TIME_UNITS: &[&str] = &["s", "ms"];

const ANIM_ELEM_ALLOWED: &[&str] = &[
    "AMS", "BFRAC", "DENS", "EPSP", "ENERGY", "ENER", "EINT", "VONM", "PRES", "P",
    "DAM1", "DAM2", "DAM3", "DAMG", "DT", "EPSD", "EPSX", "FAIL", "HOURG", "K",
    "LAW51_ALL", "LAW51_1", "LAW51_2", "LAW51_3", "LAW51_4", "MACH", "OFF",
    "SIGX", "SIGY", "SIGZ", "SIGXY", "SIGYZ", "SIGZX", "THIC", "THICK", "TEMP", "VFRAC",
    "THIN", "SSP", "VOLU", "TRUSS/EPSX", "BRICK/TENS/STRESS",
];

const ANIM_NODA_ALLOWED: &[&str] = &[
    "DT", "DMAS", "DINER", "NDMAS", "DAMA2", "DENS", "P", "TEMP", "VFRAC", "SSP", "PCONT2",
];

const ANIM_VECT_ALLOWED: &[&str] = &[
    "ACC", "CONT", "DISP", "FINT", "FVEL", "PCONT", "PCONT2", "VEL", "FEXT", "CONT2",
    "FREAC", "MREAC", "FOPT", "VROT", "DROT", "CONT/MAX", "CLUST/FORCE", "CLUST/MOM",
];

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
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

/// Parse Radioss `/GRAV` translational axis token with optional polarity sign.
/// Returns `(radioss_dir, sign)`.
fn parse_gravity_direction(direction: &str) -> Option<(&'static str, f64)> {
    match direction.trim().to_ascii_uppercase().as_str() {
        "X" | "+X" => Some(("X", 1.0)),
        "-X" => Some(("X", -1.0)),
        "Y" | "+Y" => Some(("Y", 1.0)),
        "-Y" => Some(("Y", -1.0)),
        "Z" | "+Z" => Some(("Z", 1.0)),
        "-Z" => Some(("Z", -1.0)),
        _ => None,
    }
}

fn validate_curve_points(
    curve: &[RadiossCurvePoint],
    field_prefix: &str,
    label: &str,
    end_time: f64,
    diagnostics: &mut Vec<Diagnostic>,
) -> Vec<(f64, f64)> {
    if curve.len() < 2 {
        diagnostics.push(
            err("LC-CURVE-001", format!("{label}至少需要两个时间/横坐标点"))
                .field(field_prefix),
        );
    }
    let mut points = Vec::with_capacity(curve.len());
    for (i, p) in curve.iter().enumerate() {
        if !p.time.is_finite() || !p.value.is_finite() {
            diagnostics.push(
                err("LC-CURVE-001", format!("{label}第 {} 点包含 NaN/Inf", i + 1))
                    .field(format!("{field_prefix}[{i}]")),
            );
        }
        if i > 0 {
            let prev = curve[i - 1].time;
            if p.time.is_finite() && prev.is_finite() && p.time <= prev {
                diagnostics.push(
                    err(
                        "LC-CURVE-001",
                        format!(
                            "{label}时间/横坐标必须严格递增：第 {} 点 {} 不大于前一点 {}",
                            i + 1,
                            p.time,
                            prev
                        ),
                    )
                    .field(format!("{field_prefix}[{i}].time")),
                );
            }
        }
        points.push((p.time, p.value));
    }
    if let Some(last) = points.last() {
        if last.0.is_finite() && end_time.is_finite() && end_time > 0.0 && last.0 < end_time {
            diagnostics.push(
                warn(
                    "LC-CURVE-001",
                    format!(
                        "{label}末点时间 {} 早于运行终止时间 {}；区间外将按末两点斜率线性外推，请确认",
                        last.0, end_time
                    ),
                )
                .field(field_prefix),
            );
        }
    }
    points
}

fn normalize_anim_tokens(
    raw: &[String],
    allowed: &[&str],
    field: &str,
    card_label: &str,
    diagnostics: &mut Vec<Diagnostic>,
) -> Vec<String> {
    let mut out = Vec::new();
    for item in raw {
        let up = item.trim().to_ascii_uppercase();
        let up = if card_label == "ENG_ANIM_ELEM" {
            match up.as_str() {
                "ENER" => "ENERGY".into(),
                "P" => "PRES".into(),
                "THICK" => "THIC".into(),
                "EPSX" => "TRUSS/EPSX".into(),
                _ => up,
            }
        } else {
            up
        };
        if up.is_empty() {
            continue;
        }
        if !allowed.contains(&up.as_str()) {
            diagnostics.push(
                err(
                    "LC-INPUT-001",
                    format!("{card_label} 包含不受支持的选项“{up}”"),
                )
                .field(field),
            );
            continue;
        }
        if !out.contains(&up) {
            out.push(up);
        }
    }
    out
}

/// Parse Radioss `/IMPDISP` axis token with optional sign.
/// Returns `(radioss_dir, f_scale_y, dof_index_0_to_5)`.
fn parse_load_direction(direction: &str) -> Option<(&'static str, f64, usize)> {
    match direction.trim().to_ascii_uppercase().as_str() {
        "X" | "+X" => Some(("X", 1.0, 0)),
        "-X" => Some(("X", -1.0, 0)),
        "Y" | "+Y" => Some(("Y", 1.0, 1)),
        "-Y" => Some(("Y", -1.0, 1)),
        "Z" | "+Z" => Some(("Z", 1.0, 2)),
        "-Z" => Some(("Z", -1.0, 2)),
        "XX" | "+XX" => Some(("XX", 1.0, 3)),
        "-XX" => Some(("XX", -1.0, 3)),
        "YY" | "+YY" => Some(("YY", 1.0, 4)),
        "-YY" => Some(("YY", -1.0, 4)),
        "ZZ" | "+ZZ" => Some(("ZZ", 1.0, 5)),
        "-ZZ" => Some(("ZZ", -1.0, 5)),
        _ => None,
    }
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn normalize(v: [f64; 3]) -> Option<[f64; 3]> {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if !len.is_finite() || len <= 1.0e-9 {
        None
    } else {
        Some([v[0] / len, v[1] / len, v[2] / len])
    }
}

/// Build an orthonormal `(y_axis, z_axis)` pair for `/SKEW/FIX` such that
/// `y_axis × z_axis == normalize(dir)`, aligning local X' with `dir`.
fn skew_axes_for_x(dir: [f64; 3]) -> Option<([f64; 3], [f64; 3])> {
    let x = normalize(dir)?;
    let helper = if x[2].abs() < 0.9 {
        [0.0, 0.0, 1.0]
    } else {
        [1.0, 0.0, 0.0]
    };
    let y = normalize(cross(helper, x))?;
    let z = normalize(cross(x, y))?;
    Some((y, z))
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
                "Run Name 必须由 4–80 个 ASCII 字母、数字、下划线、点或连字符组成，且不能包含连续两个点",
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
    let dir_mode = spec.loading.direction_mode.trim().to_ascii_lowercase();
    let is_vector_mode = dir_mode == "vector";
    if dir_mode != "axis" && dir_mode != "vector" && !dir_mode.is_empty() {
        diagnostics.push(
            err("LC-INPUT-001", "加载方向模式必须是 axis 或 vector")
                .field("loading.directionMode"),
        );
    }

    let mut axis: Option<usize> = None;
    let mut direction = "X".to_string();
    let mut load_f_scale = 1.0_f64;
    let mut custom_skew_axes: Option<([f64; 3], [f64; 3], [f64; 3], [f64; 3])> = None;

    if is_vector_mode {
        if spec.loading.skew_id.unwrap_or(0) != 0 {
            diagnostics.push(
                err(
                    "LC-CONFLICT-001",
                    "自定义方向向量模式会自动生成 /SKEW/FIX，请勿同时填写外部 Skew ID（如需使用已有 Skew，请切换为坐标轴模式）",
                )
                .field("loading.skewId"),
            );
        }
        let vec = spec.loading.direction_vector.unwrap_or([0.0, 0.0, 0.0]);
        let origin = spec.loading.vector_origin.unwrap_or([0.0, 0.0, 0.0]);
        if !vec.iter().all(|v| v.is_finite()) {
            diagnostics.push(
                err("LC-INPUT-001", "自定义加载方向向量包含 NaN/Inf")
                    .field("loading.directionVector"),
            );
        }
        if !origin.iter().all(|v| v.is_finite()) {
            diagnostics.push(
                err("LC-INPUT-001", "自定义 Skew 原点坐标包含 NaN/Inf")
                    .field("loading.vectorOrigin"),
            );
        }
        match skew_axes_for_x(vec) {
            Some((y_axis, z_axis)) => {
                let unit = normalize(vec).unwrap();
                custom_skew_axes = Some((origin, y_axis, z_axis, unit));
                direction = "X".to_string();
                load_f_scale = 1.0;
            }
            None => {
                diagnostics.push(
                    err("LC-INPUT-001", "自定义加载方向向量不能为零向量")
                        .field("loading.directionVector"),
                );
            }
        }
    } else {
        match parse_load_direction(&spec.loading.direction) {
            Some((d, f_scale, dof_idx)) => {
                direction = d.to_string();
                load_f_scale = f_scale;
                axis = Some(dof_idx);
            }
            None => {
                diagnostics.push(
                    err(
                        "LC-INPUT-001",
                        "加载方向必须是 +X/-X/+Y/-Y/+Z/-Z 或转动 +XX/-XX/+YY/-YY/+ZZ/-ZZ",
                    )
                    .field("loading.direction"),
                );
            }
        }
    }

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
    let emit_tfile = eng.control.as_ref().and_then(|ctrl| ctrl.emit_tfile).unwrap_or(true);
    if emit_tfile && (!eng.time_history_interval.is_finite() || eng.time_history_interval <= 0.0) {
        diagnostics.push(
            err("LC-INPUT-001", "时程输出间隔必须为正的有限值")
                .field("engine.timeHistoryInterval"),
        );
    }
    if !emit_tfile && spec.time_histories.iter().any(|history| history.enabled) {
        diagnostics.push(err("LC-INPUT-001", "已启用 /TH 输出，请同时启用 Engine 的 /TFILE")
            .field("engine.control.emitTfile"));
    }
    if emit_tfile && eng.end_time > 0.0 && eng.time_history_interval >= eng.end_time {
        diagnostics.push(warn("LC-INPUT-001", "/TFILE 采样间隔不小于运行时间，时程点可能过少")
            .field("engine.timeHistoryInterval"));
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
    if let Some(lg) = load_existing_grnod {
        if let Some(axis) = axis {
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
        } else if let Some((_, _, _, unit)) = custom_skew_axes {
            for (i, c) in constraints.iter().enumerate() {
                if c.existing_grnod == Some(lg)
                    && c.skew_id == 0
                    && ((unit[0].abs() > 1e-6 && c.dofs[0])
                        || (unit[1].abs() > 1e-6 && c.dofs[1])
                        || (unit[2].abs() > 1e-6 && c.dofs[2]))
                {
                    diagnostics.push(
                        err(
                            "LC-CONFLICT-001",
                            format!(
                                "加载节点组 {} 的第 {} 个约束固定了自定义方向向量所在的全局平动自由度，IMPDISP 与 BCS 冲突",
                                lg,
                                i + 1
                            ),
                        )
                        .field(format!("references.constraints[{i}].dofs")),
                    );
                }
            }
        }
    }

    // ---- contacts (/INTER/TYPE7, Radioss 2022) --------------------------
    let mut normalized_ibcs: Vec<String> = Vec::with_capacity(spec.contacts.len());
    for (i, ct) in spec.contacts.iter().enumerate() {
        let prefix = format!("contacts[{i}]");
        if ct.slave_grnod_id == 0 {
            diagnostics.push(
                err("LC-REF-001", format!("第 {} 个接触的从节点组 Set ID (grnd_IDs) 必须为正整数", i + 1))
                    .field(format!("{prefix}.slaveGrnodId")),
            );
        }
        if ct.master_surf_id == 0 {
            diagnostics.push(
                err("LC-REF-001", format!("第 {} 个接触的主表面 Set ID (surf_IDm) 必须为正整数", i + 1))
                    .field(format!("{prefix}.masterSurfId")),
            );
        }
        if !matches!(ct.istf, 0 | 1 | 2 | 3 | 4 | 5 | 1000) {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 Istf={} 非法（Radioss 2022 支持 0/1/2/3/4/5/1000）", i + 1, ct.istf))
                    .field(format!("{prefix}.istf")),
            );
        }
        if !matches!(ct.ithe, 0 | 1) {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 Ithe={} 非法（仅支持 0/1）", i + 1, ct.ithe))
                    .field(format!("{prefix}.ithe")),
            );
        }
        if ct.ithe == 1 {
            if let Some(heat) = &ct.thermal {
                if !matches!(heat.formulation, 0 | 1) {
                    diagnostics.push(err("LC-INPUT-001", "TYPE7 Ithe_form 必须为 0 或 1")
                        .field(format!("{prefix}.thermal.formulation")));
                }
                for (field, value) in [
                    ("coefficient", heat.coefficient), ("interfaceTemperature", heat.interface_temperature),
                    ("pressureScale", heat.pressure_scale), ("radiationFactor", heat.radiation_factor),
                    ("radiationDistance", heat.radiation_distance), ("secondaryFrictionHeat", heat.secondary_friction_heat),
                    ("mainFrictionHeat", heat.main_friction_heat),
                ] {
                    if !value.is_finite() || value < 0.0 {
                        diagnostics.push(err("LC-INPUT-001", format!("TYPE7 热接触参数 {field} 必须为非负有限实数"))
                            .field(format!("{prefix}.thermal.{field}")));
                    }
                }
            } else {
                diagnostics.push(err("LC-INPUT-001", "TYPE7 Ithe=1 需要定义热接触参数")
                    .field(format!("{prefix}.thermal")));
            }
        }
        if !matches!(ct.igap, 0 | 1 | 2 | 3 | 1000) {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 Igap={} 非法（Radioss 2022 支持 0/1/2/3/1000）", i + 1, ct.igap))
                    .field(format!("{prefix}.igap")),
            );
        }
        if !matches!(ct.ibag, 0 | 1 | 2 | 1000) {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 Ibag={} 非法（Radioss 2022 支持 0/1/2）", i + 1, ct.ibag))
                    .field(format!("{prefix}.ibag")),
            );
        }
        if !matches!(ct.idel, -2 | -1 | 0 | 1 | 2 | 1000) {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 Idel={} 非法（支持 -2/-1/0/1/2/1000）", i + 1, ct.idel))
                    .field(format!("{prefix}.idel")),
            );
        }
        if !matches!(ct.icurv, 0..=3) {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 Icurv={} 非法（支持 0/1/2/3）", i + 1, ct.icurv))
                    .field(format!("{prefix}.icurv")),
            );
        } else if matches!(ct.icurv, 1 | 2) {
            if ct.curv_node_id1.unwrap_or(0) == 0 {
                diagnostics.push(err("LC-REF-001", format!("第 {} 个接触缺少曲率节点 node_ID1", i + 1))
                    .field(format!("{prefix}.curvNodeId1")));
            }
            if ct.icurv == 2 && ct.curv_node_id2.unwrap_or(0) == 0 {
                diagnostics.push(err("LC-REF-001", format!("第 {} 个接触缺少圆柱曲率节点 node_ID2", i + 1))
                    .field(format!("{prefix}.curvNodeId2")));
            }
        }
        if !matches!(ct.iadm, 0 | 1) {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 Iadm={} 非法（仅支持 0/1）", i + 1, ct.iadm))
                    .field(format!("{prefix}.iadm")),
            );
        }
        if !matches!(ct.i_tied, 0..=2) {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 I_TIED={} 非法（支持 0/1/2）", i + 1, ct.i_tied))
                    .field(format!("{prefix}.iTied")),
            );
        } else if ct.i_tied != 0 {
            diagnostics.push(warn("LC-CONTACT-001", "非零 I_TIED 已写入 Radioss 文件。实测 HyperMesh 的 Radioss 2022 模板回导时会丢弃该字段，请核对最终求解文件")
                .field(format!("{prefix}.iTied")));
        }
        if !matches!(ct.irem_gap, 0 | 1 | 2) {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 Irem_gap={} 非法（支持 0/1/2）", i + 1, ct.irem_gap))
                    .field(format!("{prefix}.iremGap")),
            );
        }
        if !matches!(ct.irem_i2, 0 | 1 | 3) {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 Irem_i2={} 非法（支持 0/1/3）", i + 1, ct.irem_i2))
                    .field(format!("{prefix}.iremI2")),
            );
        }
        if !matches!(ct.inacti, 0 | 1 | 2 | 3 | 5 | 6 | 1000) {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 Inacti={} 非法（支持 0/1/2/3/5/6/1000）", i + 1, ct.inacti))
                    .field(format!("{prefix}.inacti")),
            );
        }
        if !matches!(ct.ifric, 0 | 1 | 2 | 3) {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 Ifric={} 非法（支持 0/1/2/3）", i + 1, ct.ifric))
                    .field(format!("{prefix}.ifric")),
            );
        }
        if !matches!(ct.ifiltr, 0 | 1 | 2 | 3) {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 Ifiltr={} 非法（支持 0/1/2/3）", i + 1, ct.ifiltr))
                    .field(format!("{prefix}.ifiltr")),
            );
        }
        if !matches!(ct.iform, 0 | 1 | 2) {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 Iform={} 非法（支持 0/1/2）", i + 1, ct.iform))
                    .field(format!("{prefix}.iform")),
            );
        }
        let ibc_trim = ct.ibc.trim();
        let ibc_norm = if ibc_trim.is_empty() || ibc_trim == "0" {
            "000".to_string()
        } else if ibc_trim.len() == 3 && ibc_trim.chars().all(|ch| ch == '0' || ch == '1') {
            ibc_trim.to_string()
        } else {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 IBC 必须是 3 位 0/1 标志（如 000、111）", i + 1))
                    .field(format!("{prefix}.ibc")),
            );
            "000".to_string()
        };
        normalized_ibcs.push(ibc_norm);

        let nonneg_checks: &[(&str, f64, &str)] = &[
            ("fscaleGap", ct.fscale_gap, "Fscale_gap"),
            ("gapMax", ct.gap_max, "Gapmax"),
            ("fpenmax", ct.fpenmax, "Fpenmax"),
            ("stMin", ct.st_min, "Stmin"),
            ("stMax", ct.st_max, "Stmax"),
            ("percentMeshSize", ct.percent_mesh_size, "%mesh_size"),
            ("dtmin", ct.dtmin, "dtmin"),
            ("stfac", ct.stfac, "Stfac"),
            ("fric", ct.fric, "Fric"),
            ("gapMin", ct.gap_min, "Gapmin"),
            ("tStart", ct.t_start, "Tstart"),
            ("tStop", ct.t_stop, "Tstop"),
            ("visS", ct.vis_s, "VisS"),
            ("visF", ct.vis_f, "VisF"),
            ("bumult", ct.bumult, "Bumult"),
            ("xfreq", ct.xfreq, "Xfreq"),
        ];
        for (field_name, val, label) in nonneg_checks {
            if !val.is_finite() || *val < 0.0 {
                diagnostics.push(
                    err("LC-INPUT-001", format!("第 {} 个接触 {label} 必须为非负有限实数", i + 1))
                        .field(format!("{prefix}.{field_name}")),
                );
            }
        }
        for (field_name, val, label) in [
            ("ascaleF", ct.ascale_f, "Ascale_F"),
            ("c1", ct.c1, "C1"),
            ("c2", ct.c2, "C2"),
            ("c3", ct.c3, "C3"),
            ("c4", ct.c4, "C4"),
            ("c5", ct.c5, "C5"),
            ("c6", ct.c6, "C6"),
        ] {
            if !val.is_finite() {
                diagnostics.push(
                    err("LC-INPUT-001", format!("第 {} 个接触 {label} 包含 NaN/Inf", i + 1))
                        .field(format!("{prefix}.{field_name}")),
                );
            }
        }
        if ct.t_stop > 0.0 && ct.t_stop <= ct.t_start {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 Tstop 必须大于 Tstart（或设为 0 表示全程有效）", i + 1))
                    .field(format!("{prefix}.tStop")),
            );
        }
        if ct.st_max > 0.0 && ct.st_min > ct.st_max {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个接触 Stmin 不能大于 Stmax", i + 1))
                    .field(format!("{prefix}.stMin")),
            );
        }
        if ct.gap_min == 0.0 {
            diagnostics.push(
                warn(
                    "LC-CONTACT-001",
                    format!("第 {} 个接触 Gapmin 为 0：Radioss 将按最小单元尺度估算，工装-模型接触建议显式设为 0.1~0.5 mm", i + 1),
                )
                .field(format!("{prefix}.gapMin")),
            );
        }
        if ct.inacti == 0 || ct.inacti == 1000 {
            diagnostics.push(
                warn(
                    "LC-CONTACT-001",
                    format!("第 {} 个接触 Inacti={} 不处理初始穿透：若工装与模型存在初始穿透，建议设为 6", i + 1, ct.inacti),
                )
                .field(format!("{prefix}.inacti")),
            );
        }
    }

    // ---- gravity (single legacy or multi-case list) ----------------------
    struct PreparedGravity {
        title: String,
        direction: String,
        use_curve: bool,
        existing_funct_id: Option<u64>,
        curve_points: Vec<(f64, f64)>,
        a_scale: f64,
        f_scale: f64,
        skew_id: u64,
        sensor_id: u64,
        grnod_id: u64,
    }
    let title = ascii_stem(&spec.name);
    let raw_gravities: Vec<&RadiossGravity> = if !spec.gravities.is_empty() {
        spec.gravities.iter().collect()
    } else if let Some(g) = &spec.gravity {
        vec![g]
    } else {
        Vec::new()
    };
    let mut prepared_gravities: Vec<PreparedGravity> = Vec::new();
    for (gi, g) in raw_gravities.iter().enumerate() {
        if !g.enabled {
            continue;
        }
        let g_prefix = if spec.gravities.is_empty() {
            "gravity".to_string()
        } else {
            format!("gravities[{gi}]")
        };
        let (dir_axis, dir_sign) = match parse_gravity_direction(&g.direction) {
            Some(pair) => pair,
            None => {
                diagnostics.push(
                    err(
                        "LC-INPUT-001",
                        format!("第 {} 个重力场方向“{}”非法，必须是 +X/-X/+Y/-Y/+Z/-Z", gi + 1, g.direction),
                    )
                    .field(format!("{g_prefix}.direction")),
                );
                ("Z", 1.0)
            }
        };
        let g_mode = g.mode.trim().to_ascii_lowercase();
        let is_curve_mode = g_mode == "curve";
        if g_mode != "constant" && g_mode != "curve" && !g_mode.is_empty() {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个重力场模式必须是 constant 或 curve", gi + 1))
                    .field(format!("{g_prefix}.mode")),
            );
        }
        if !g.a_scale.is_finite() || g.a_scale <= 0.0 {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个重力场时间缩放 Ascale_x 必须为正有限值", gi + 1))
                    .field(format!("{g_prefix}.aScale")),
            );
        }
        let effective_f_scale = if is_curve_mode {
            let raw_scale = g.f_scale.unwrap_or_else(|| {
                if g.magnitude.is_finite() && g.magnitude != 0.0 {
                    g.magnitude
                } else {
                    1.0
                }
            });
            if !raw_scale.is_finite() || raw_scale == 0.0 {
                diagnostics.push(
                    err("LC-INPUT-001", format!("第 {} 个重力场幅值比例 Fscale_Y 必须为非零有限值", gi + 1))
                        .field(format!("{g_prefix}.fScale")),
                );
            }
            dir_sign * raw_scale
        } else {
            let raw_mag = g.f_scale.unwrap_or(g.magnitude);
            if !raw_mag.is_finite() || raw_mag == 0.0 {
                diagnostics.push(
                    err("LC-INPUT-001", format!("第 {} 个重力场幅值必须为非零有限值（工作单位下的加速度）", gi + 1))
                        .field(format!("{g_prefix}.magnitude")),
                );
            }
            dir_sign * raw_mag
        };
        let mut curve_points = Vec::new();
        let mut existing_funct_id = None;
        if is_curve_mode {
            if let Some(fid) = g.existing_funct_id.filter(|id| *id > 0) {
                existing_funct_id = Some(fid);
            } else {
                let curve_end = if g.sensor_id.unwrap_or(0) == 0 && g.a_scale > 0.0 {
                    eng.end_time / g.a_scale
                } else {
                    0.0
                };
                curve_points = validate_curve_points(
                    &g.curve,
                    &format!("{g_prefix}.curve"),
                    &format!("第 {} 个重力曲线", gi + 1),
                    curve_end,
                    &mut diagnostics,
                );
            }
        }
        let g_title = if g.title.trim().is_empty() {
            if raw_gravities.len() == 1 {
                format!("{title}_GRAV")
            } else {
                format!("{title}_GRAV_{}", gi + 1)
            }
        } else {
            ascii_stem(&g.title)
        };
        prepared_gravities.push(PreparedGravity {
            title: g_title,
            direction: dir_axis.to_string(),
            use_curve: is_curve_mode,
            existing_funct_id,
            curve_points,
            a_scale: g.a_scale,
            f_scale: effective_f_scale,
            skew_id: g.skew_id.unwrap_or(0),
            sensor_id: g.sensor_id.unwrap_or(0),
            grnod_id: g.grnod_id.unwrap_or(0),
        });
    }

    // ---- engine control cards (/VERS, /PARITH, /PRINT, /ANIM/*, /TFILE) --
    let mut norm_anim_elem: Vec<String> = Vec::new();
    let mut norm_anim_noda: Vec<String> = Vec::new();
    let mut norm_anim_vect: Vec<String> = Vec::new();
    let mut tfile_type: Option<u32> = None;
    if let Some(ctrl) = &eng.control {
        if ctrl.emit_vers && ctrl.version_num != 2022 {
            diagnostics.push(
                err("LC-INPUT-001", "ENG_VERS 必须与本文件 Starter 版本 2022 一致")
                    .field("engine.control.versionNum"),
            );
        }
        if ctrl.emit_print && ctrl.n_print == 0 {
            diagnostics.push(
                warn("LC-INPUT-001", "ENG_PRINT 的 N_print 为 0，求解器将不周期打印状态行")
                    .field("engine.control.nPrint"),
            );
        }
        if let Some(tt) = ctrl.tfile_type.filter(|_| emit_tfile) {
            if tt > 4 {
                diagnostics.push(
                    err("LC-INPUT-001", format!("ENG_TFILE Type={tt} 非法（Radioss 2022 支持 0–4）"))
                        .field("engine.control.tfileType"),
                );
            } else {
                tfile_type = Some(tt);
            }
        }
        if emit_tfile && ctrl.th_version.is_some_and(|version| !matches!(version, 41 | 51 | 2021)) {
            diagnostics.push(
                err("LC-INPUT-001", "/TH/VERS 支持 41、51 或 2021")
                    .field("engine.control.thVersion"),
            );
        }
        norm_anim_elem = normalize_anim_tokens(
            &ctrl.anim_elem,
            ANIM_ELEM_ALLOWED,
            "engine.control.animElem",
            "ENG_ANIM_ELEM",
            &mut diagnostics,
        );
        norm_anim_noda = normalize_anim_tokens(
            &ctrl.anim_noda,
            ANIM_NODA_ALLOWED,
            "engine.control.animNoda",
            "ENG_ANIM_NODA",
            &mut diagnostics,
        );
        norm_anim_vect = normalize_anim_tokens(
            &ctrl.anim_vect,
            ANIM_VECT_ALLOWED,
            "engine.control.animVect",
            "ENG_ANIM_VECT",
            &mut diagnostics,
        );
    }

    // ---- extra Radioss Functions (/FUNCT library) ------------------------
    struct PreparedExtraFunct {
        title: String,
        explicit_id: Option<u64>,
        points: Vec<(f64, f64)>,
    }
    let mut prepared_extra_functs: Vec<PreparedExtraFunct> = Vec::new();
    for (fi, f) in spec.functions.iter().enumerate() {
        let f_prefix = format!("functions[{fi}]");
        if let Some(eid) = f.explicit_id {
            if eid == 0 {
                diagnostics.push(
                    err("LC-INPUT-001", format!("第 {} 个自定义 Function ID 不能为 0", fi + 1))
                        .field(format!("{f_prefix}.explicitId")),
                );
            }
        }
        let pts = validate_curve_points(
            &f.points,
            &format!("{f_prefix}.points"),
            &format!("第 {} 个 Radioss Function", fi + 1),
            0.0,
            &mut diagnostics,
        );
        let f_title = if f.title.trim().is_empty() {
            format!("{title}_FUNCT_{}", fi + 1)
        } else {
            ascii_stem(&f.title)
        };
        prepared_extra_functs.push(PreparedExtraFunct {
            title: f_title,
            explicit_id: f.explicit_id,
            points: pts,
        });
    }

    // ---- allocate ids (preserve legacy order first so golden matches!) ----
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
    let custom_skew_id = if custom_skew_axes.is_some() {
        Some(alloc.allocate(RadIdKind::Skew, "load#skew"))
    } else {
        None
    };
    let impdisp_id = alloc.allocate(RadIdKind::Impdisp, "load#impdisp");
    let bcs_ids: Vec<u64> = constraints
        .iter()
        .enumerate()
        .map(|(i, _)| alloc.allocate(RadIdKind::Bcs, &format!("constraint#{i}#bcs")))
        .collect();
    let grav_ids: Vec<u64> = prepared_gravities
        .iter()
        .enumerate()
        .map(|(i, _)| {
            if i == 0 {
                alloc.allocate(RadIdKind::Grav, "gravity#grav")
            } else {
                alloc.allocate(RadIdKind::Grav, &format!("gravity#{i}#grav"))
            }
        })
        .collect();
    let inter_ids: Vec<u64> = spec
        .contacts
        .iter()
        .enumerate()
        .map(|(i, _)| alloc.allocate(RadIdKind::Inter, &format!("contact#{i}#inter")))
        .collect();
    let grav_funct_ids: Vec<u64> = prepared_gravities
        .iter()
        .enumerate()
        .map(|(i, pg)| {
            if !pg.use_curve {
                0
            } else if let Some(fid) = pg.existing_funct_id {
                fid
            } else {
                alloc.allocate(RadIdKind::Funct, &format!("gravity#{i}#funct"))
            }
        })
        .collect();
    let extra_funct_ids: Vec<u64> = prepared_extra_functs
        .iter()
        .enumerate()
        .map(|(i, pf)| match pf.explicit_id {
            Some(eid) if eid > 0 => eid,
            _ => alloc.allocate(RadIdKind::Funct, &format!("extra#{i}#funct")),
        })
        .collect();
    let mut function_ids = std::collections::HashSet::from([funct_id]);
    for (i, gravity) in prepared_gravities.iter().enumerate() {
        if gravity.use_curve && gravity.existing_funct_id.is_none() {
            function_ids.insert(grav_funct_ids[i]);
        }
    }
    for (i, &id) in extra_funct_ids.iter().enumerate() {
        if !function_ids.insert(id) {
            diagnostics.push(err("LC-CONFLICT-001", format!("/FUNCT ID {id} 重复，请更改自定义编号或自动编号起点"))
                .field(format!("functions[{i}].explicitId")));
        }
    }

    // ---- Time History (/TH/*) validation & id allocation -----------------
    struct PreparedTh {
        id: u64,
        kind_upper: String,
        title: String,
        variables: Vec<String>,
        nodes: Vec<(u64, u64, String)>,
        elements: Vec<(u64, String)>,
        object_ids: Vec<u64>,
    }
    let mut prepared_ths: Vec<PreparedTh> = Vec::new();
    for (ti, th) in spec.time_histories.iter().enumerate() {
        if !th.enabled {
            continue;
        }
        let th_prefix = format!("timeHistories[{ti}]");
        let kind_lower = th.kind.trim().to_ascii_lowercase();
        let kind_upper = match kind_lower.as_str() {
            "spring" => "SPRING",
            "beam" => "BEAM",
            "sectio" => "SECTIO",
            "rbody" => "RBODY",
            "rwall" => "RWALL",
            "node" => "NODE",
            "inter" => "INTER",
            "part" => "PART",
            _ => {
                diagnostics.push(
                    err(
                        "LC-INPUT-001",
                        format!("第 {} 个 /TH 输出曲线类型“{}”不受支持", ti + 1, th.kind),
                    )
                    .field(format!("{th_prefix}.kind")),
                );
                "NODE"
            }
        }
        .to_string();

        let mut vars: Vec<String> = th
            .variables
            .iter()
            .map(|v| v.trim().to_ascii_uppercase())
            .filter(|v| !v.is_empty())
            .collect();
        if kind_upper == "NODE" && vars.iter().any(|v| v == "REAC") {
            vars = vars.into_iter().flat_map(|v| {
                if v == "REAC" { vec!["REACX".into(), "REACY".into(), "REACZ".into()] } else { vec![v] }
            }).collect();
            let mut seen = std::collections::HashSet::new();
            vars.retain(|v| seen.insert(v.clone()));
        }
        if vars.is_empty() {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个 /TH 输出曲线至少需要选择 1 个变量", ti + 1))
                    .field(format!("{th_prefix}.variables")),
            );
        } else if vars.len() > 10 {
            diagnostics.push(
                err("LC-INPUT-001", format!("第 {} 个 /TH 输出曲线最多允许 10 个变量（当前 {} 个）", ti + 1, vars.len()))
                    .field(format!("{th_prefix}.variables")),
            );
        }
        for v in &vars {
            if !v.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'|') || v.len() > 8 {
                diagnostics.push(
                    err("LC-INPUT-001", format!("第 {} 个 /TH 变量名“{v}”必须为 1–8 位 ASCII 字符", ti + 1))
                        .field(format!("{th_prefix}.variables")),
                );
            }
            if kind_upper == "INTER" && matches!(v.as_str(), "CE_ELAST" | "CE_FRIC" | "CE_DAMP")
                && eng.control.as_ref().and_then(|ctrl| ctrl.th_version) != Some(2021)
            {
                diagnostics.push(err("LC-INPUT-001", format!("/TH/INTER 的 {v} 需要 /TH/VERS/2021"))
                    .field(format!("{th_prefix}.variables")));
            }
        }

        let mut nodes: Vec<(u64, u64, String)> = Vec::new();
        let mut elements: Vec<(u64, String)> = Vec::new();
        let mut object_ids: Vec<u64> = Vec::new();

        match kind_upper.as_str() {
            "NODE" => {
                if th.nodes.is_empty() {
                    diagnostics.push(
                        err("LC-REF-001", format!("第 {} 个 /TH/NODE 至少需要填写 1 个节点号", ti + 1))
                            .field(format!("{th_prefix}.nodes")),
                    );
                }
                for (ni, entry) in th.nodes.iter().enumerate() {
                    if entry.node_id == 0 {
                        diagnostics.push(
                            err("LC-REF-001", format!("第 {} 个 /TH/NODE 第 {} 项节点号不能为 0", ti + 1, ni + 1))
                                .field(format!("{th_prefix}.nodes[{ni}].nodeId")),
                        );
                    }
                    let lbl = if entry.label.trim().is_empty() {
                        String::new()
                    } else {
                        ascii_stem(&entry.label)
                    };
                    nodes.push((entry.node_id, entry.skew_id, lbl));
                }
            }
            "SPRING" | "BEAM" => {
                if th.elements.is_empty() {
                    diagnostics.push(
                        err(
                            "LC-REF-001",
                            format!("第 {} 个 /TH/{kind_upper} 至少需要填写 1 个单元 ID", ti + 1),
                        )
                        .field(format!("{th_prefix}.elements")),
                    );
                }
                for (ei, entry) in th.elements.iter().enumerate() {
                    if entry.elem_id == 0 {
                        diagnostics.push(
                            err(
                                "LC-REF-001",
                                format!("第 {} 个 /TH/{kind_upper} 第 {} 项单元 ID 不能为 0", ti + 1, ei + 1),
                            )
                            .field(format!("{th_prefix}.elements[{ei}].elemId")),
                        );
                    }
                    let lbl = if entry.label.trim().is_empty() {
                        String::new()
                    } else {
                        ascii_stem(&entry.label)
                    };
                    elements.push((entry.elem_id, lbl));
                }
            }
            _ => {
                if kind_upper == "INTER" && !th.contact_indices.is_empty() {
                    for &cidx in &th.contact_indices {
                        if let Some(&cid) = inter_ids.get(cidx) {
                            if !object_ids.contains(&cid) {
                                object_ids.push(cid);
                            }
                        } else {
                            diagnostics.push(
                                err(
                                    "LC-REF-001",
                                    format!("第 {} 个 /TH/INTER 引用的接触序号 {} 不存在", ti + 1, cidx + 1),
                                )
                                .field(format!("{th_prefix}.contactIndices")),
                            );
                        }
                    }
                }
                for &oid in &th.object_ids {
                    if !object_ids.contains(&oid) {
                        object_ids.push(oid);
                    }
                }
                if object_ids.is_empty() || object_ids.contains(&0) {
                    diagnostics.push(
                        err("LC-REF-001", format!("第 {} 个 /TH/{kind_upper} 需要至少一个有效的模型对象 ID", ti + 1))
                            .field(format!("{th_prefix}.objectIds")),
                    );
                }
            }
        }

        let th_id = alloc.allocate(RadIdKind::Th, &format!("th#{ti}#{kind_lower}"));
        let th_title = if th.title.trim().is_empty() {
            format!("{title}_TH_{kind_upper}_{}", ti + 1)
        } else {
            ascii_stem(&th.title)
        };
        prepared_ths.push(PreparedTh {
            id: th_id,
            kind_upper,
            title: th_title,
            variables: vars,
            nodes,
            elements,
            object_ids,
        });
    }

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
    for (i, ct) in spec.contacts.iter().enumerate() {
        if ct.slave_grnod_id > 0 {
            note(
                "grnod",
                ct.slave_grnod_id,
                Some(format!("contact {} slave set (model)", i + 1)),
                "radioss-type7",
            );
        }
        if ct.master_surf_id > 0 {
            note(
                "surf",
                ct.master_surf_id,
                Some(format!("contact {} master set (tool)", i + 1)),
                "radioss-type7",
            );
        }
        if ct.icurv == 1 || ct.icurv == 2 {
            if let Some(n1) = ct.curv_node_id1 {
                if n1 > 0 {
                    note("node", n1, Some(format!("contact {} Icurv node 1", i + 1)), "radioss-type7");
                }
            }
            if let Some(n2) = ct.curv_node_id2 {
                if n2 > 0 {
                    note("node", n2, Some(format!("contact {} Icurv node 2", i + 1)), "radioss-type7");
                }
            }
        }
        if ct.sens_id > 0 {
            note("sensor", ct.sens_id, Some(format!("contact {} sensor", i + 1)), "radioss-type7");
        }
        if ct.fct_id_f > 0 {
            note("funct", ct.fct_id_f, Some(format!("contact {} friction funct", i + 1)), "radioss-type7");
        }
        if let Some(heat) = ct.thermal.as_ref().filter(|heat| ct.ithe == 1 && heat.function_id > 0) {
            note("funct", heat.function_id, Some(format!("contact {} heat exchange funct", i + 1)), "radioss-type7");
        }
        if ct.fric_id > 0 {
            note("friction", ct.fric_id, Some(format!("contact {} friction card", i + 1)), "radioss-type7");
        }
    }
    for (gi, pg) in prepared_gravities.iter().enumerate() {
        if let Some(fid) = pg.existing_funct_id.filter(|id| !extra_funct_ids.contains(id)) {
            note("funct", fid, Some(format!("gravity {} function", gi + 1)), "radioss-grav");
        }
        if pg.skew_id > 0 {
            note("skew", pg.skew_id, Some(format!("gravity {} skew", gi + 1)), "radioss-grav");
        }
        if pg.sensor_id > 0 {
            note("sensor", pg.sensor_id, Some(format!("gravity {} sensor", gi + 1)), "radioss-grav");
        }
        if pg.grnod_id > 0 {
            note("grnod", pg.grnod_id, Some(format!("gravity {} node group", gi + 1)), "radioss-grav");
        }
    }
    for (ti, pth) in prepared_ths.iter().enumerate() {
        match pth.kind_upper.as_str() {
            "NODE" => {
                for (nid, skid, _) in &pth.nodes {
                    if *nid > 0 {
                        note("node", *nid, Some(format!("TH {} node", ti + 1)), "radioss-th");
                    }
                    if *skid > 0 {
                        note("skew", *skid, Some(format!("TH {} skew", ti + 1)), "radioss-th");
                    }
                }
            }
            "SPRING" | "BEAM" => {
                let kind_key = pth.kind_upper.to_ascii_lowercase();
                for (eid, _) in &pth.elements {
                    if *eid > 0 {
                        note(&kind_key, *eid, Some(format!("TH {} elem", ti + 1)), "radioss-th");
                    }
                }
            }
            other => {
                let kind_key = other.to_ascii_lowercase();
                for oid in &pth.object_ids {
                    if *oid > 0 && !(other == "INTER" && inter_ids.contains(oid)) {
                        note(&kind_key, *oid, Some(format!("TH {} object", ti + 1)), "radioss-th");
                    }
                }
            }
        }
    }

    // ---- build deck ------------------------------------------------------
    let mut deck = RadiossDeck::default();

    if let Some(ctrl) = &eng.control {
        if ctrl.emit_vers {
            deck.engine.push(EngineCard::Vers {
                version: ctrl.version_num,
            });
        }
    }
    deck.engine.push(EngineCard::Run {
        name: run_name.clone(),
        number: 1,
        t_stop: eng.end_time,
    });
    if let Some(ctrl) = &eng.control {
        if let Some(parith_on) = ctrl.parith {
            deck.engine.push(EngineCard::Parith { on: parith_on });
        }
        if ctrl.emit_print {
            deck.engine.push(EngineCard::Print {
                n_print: ctrl.n_print,
                n_line: ctrl.n_line,
            });
        }
    }
    deck.engine.push(EngineCard::AnimationDt {
        t_start: eng.animation.start_time,
        t_freq: eng.animation.interval,
    });
    for opt in norm_anim_elem {
        deck.engine.push(EngineCard::AnimElem { option: opt });
    }
    for opt in norm_anim_noda {
        deck.engine.push(EngineCard::AnimNoda { option: opt });
    }
    for opt in norm_anim_vect {
        deck.engine.push(EngineCard::AnimVect { option: opt });
    }
    if emit_tfile {
        deck.engine.push(EngineCard::TimeHistory {
            file_type: tfile_type,
            interval: eng.time_history_interval,
        });
        if let Some(version) = eng.control.as_ref().and_then(|ctrl| ctrl.th_version) {
            deck.engine.push(EngineCard::TimeHistoryVersion { version });
        }
    }
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
    for (i, pg) in prepared_gravities.iter().enumerate() {
        if pg.use_curve && pg.existing_funct_id.is_none() {
            deck.starter.push(StarterCard::Function {
                id: grav_funct_ids[i],
                title: format!("{}_FUNCT", pg.title),
                points: pg.curve_points.clone(),
            });
        }
    }
    for (i, pf) in prepared_extra_functs.iter().enumerate() {
        deck.starter.push(StarterCard::Function {
            id: extra_funct_ids[i],
            title: pf.title.clone(),
            points: pf.points.clone(),
        });
    }
    let effective_load_skew = if let (Some(sk_id), Some((origin, y_axis, z_axis, _))) = (custom_skew_id, custom_skew_axes) {
        deck.starter.push(StarterCard::SkewFix {
            id: sk_id,
            title: format!("{title}_LOAD_DIR"),
            origin,
            y_axis,
            z_axis,
        });
        sk_id
    } else {
        spec.loading.skew_id.unwrap_or(0)
    };
    deck.starter.push(StarterCard::ImposedDisplacement {
        id: impdisp_id,
        title: format!("{title}_IMPDISP"),
        function_id: funct_id,
        direction: direction.clone(),
        skew_id: effective_load_skew,
        sensor_id: 0,
        group_id: load_group_id,
        icoor: 0,
        a_scale: 1.0,
        f_scale: load_f_scale,
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
    for (i, pg) in prepared_gravities.iter().enumerate() {
        deck.starter.push(StarterCard::Gravity {
            id: grav_ids[i],
            title: pg.title.clone(),
            function_id: grav_funct_ids[i],
            direction: pg.direction.clone(),
            skew_id: pg.skew_id,
            sensor_id: pg.sensor_id,
            group_id: pg.grnod_id,
            a_scale: pg.a_scale,
            f_scale: pg.f_scale,
        });
    }
    for (i, ct) in spec.contacts.iter().enumerate() {
        let ct_title = if ct.title.trim().is_empty() {
            format!("{title}_TYPE7_{}", i + 1)
        } else {
            ascii_stem(&ct.title)
        };
        deck.starter.push(StarterCard::InterType7 {
            id: inter_ids[i],
            title: ct_title,
            slave_grnod_id: ct.slave_grnod_id,
            master_surf_id: ct.master_surf_id,
            istf: ct.istf,
            ithe: ct.ithe,
            igap: ct.igap,
            ibag: if ct.ibag == 1000 { 2 } else { ct.ibag },
            idel: ct.idel,
            icurv: ct.icurv,
            iadm: ct.iadm,
            curv_node_id1: ct.curv_node_id1,
            curv_node_id2: if ct.icurv == 2 { ct.curv_node_id2 } else { None },
            fscale_gap: ct.fscale_gap,
            gap_max: ct.gap_max,
            fpenmax: ct.fpenmax,
            i_tied: ct.i_tied,
            st_min: ct.st_min,
            st_max: ct.st_max,
            percent_mesh_size: ct.percent_mesh_size,
            dtmin: ct.dtmin,
            irem_gap: ct.irem_gap,
            irem_i2: ct.irem_i2,
            stfac: ct.stfac,
            fric: ct.fric,
            gap_min: ct.gap_min,
            t_start: ct.t_start,
            t_stop: ct.t_stop,
            ibc: normalized_ibcs[i].clone(),
            inacti: ct.inacti,
            vis_s: ct.vis_s,
            vis_f: ct.vis_f,
            bumult: ct.bumult,
            ifric: ct.ifric,
            ifiltr: ct.ifiltr,
            xfreq: ct.xfreq,
            iform: ct.iform,
            sens_id: ct.sens_id,
            fct_id_f: ct.fct_id_f,
            ascale_f: ct.ascale_f,
            fric_id: ct.fric_id,
            c1: ct.c1,
            c2: ct.c2,
            c3: ct.c3,
            c4: ct.c4,
            c5: ct.c5,
            c6: ct.c6,
            thermal: ct.thermal.clone(),
        });
    }
    for pth in prepared_ths {
        match pth.kind_upper.as_str() {
            "NODE" => deck.starter.push(StarterCard::TimeHistoryNode {
                id: pth.id,
                title: pth.title,
                variables: pth.variables,
                nodes: pth.nodes,
            }),
            "SPRING" | "BEAM" => deck.starter.push(StarterCard::TimeHistoryElement {
                kind: pth.kind_upper,
                id: pth.id,
                title: pth.title,
                variables: pth.variables,
                elements: pth.elements,
            }),
            _ => deck.starter.push(StarterCard::TimeHistoryObject {
                kind: pth.kind_upper,
                id: pth.id,
                title: pth.title,
                variables: pth.variables,
                object_ids: pth.object_ids,
            }),
        }
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
