//! Multi-case OptiStruct 2022 assembly with cross-case compatibility checks.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use crate::core::cards::BulkCard;
use crate::core::case_spec::{CaseSpec, EntityLink, Excitation, MultiCaseItem, MultiCaseSpec};
use crate::core::deck_ir::{DeckFragment, GenerationContext};
use crate::core::ids::IdKind;
use crate::core::validation::require_units;
use crate::load_deck::{self, PointEntry};
use crate::modules::constraint::ConstraintOutput;
use crate::modules::{
    ascii_name, constraint, frequency_response, gravity, nodal_static, normal_modes, random_psd,
    BuiltCase,
};
use crate::solvers::optistruct::capabilities_2022::ensure_supported;

pub struct MultiCaseBuilt {
    pub built: BuiltCase,
    pub points: Vec<PointEntry>,
}

fn item_display_name(item: &MultiCaseItem) -> String {
    item.spec.display_name()
}

fn case_model_units(spec: &CaseSpec) -> Option<&str> {
    match spec {
        CaseSpec::NodalStatic(s) => Some(&s.model_units),
        CaseSpec::Constraint(s) => Some(&s.model_units),
        CaseSpec::Gravity(s) => Some(&s.model_units),
        CaseSpec::NormalModes(s) => Some(&s.model_units),
        CaseSpec::FrequencyResponse(s) => Some(&s.model_units),
        CaseSpec::RandomPsd(s) => Some(&s.model_units),
        CaseSpec::TabularLoad(_) => None,
        CaseSpec::RadiossRops(_) | CaseSpec::RadiossFops(_) | CaseSpec::MultiCase(_) => None,
    }
}

fn case_solver_and_version(spec: &CaseSpec) -> Option<(&str, &str)> {
    match spec {
        CaseSpec::NodalStatic(s) => Some((&s.solver, &s.solver_version)),
        CaseSpec::Constraint(s) => Some((&s.solver, &s.solver_version)),
        CaseSpec::Gravity(s) => Some((&s.solver, &s.solver_version)),
        CaseSpec::NormalModes(s) => Some((&s.solver, &s.solver_version)),
        CaseSpec::FrequencyResponse(s) => Some((&s.solver, &s.solver_version)),
        CaseSpec::RandomPsd(s) => Some((&s.solver, &s.solver_version)),
        _ => None,
    }
}

fn register_external_spc_for_item(item: &MultiCaseItem, ctx: &mut GenerationContext) {
    match &item.spc_source {
        Some(EntityLink::External { id }) if *id > 0 => {
            ctx.allocator
                .note_external(IdKind::Spc, *id, Some("external SPC set".into()));
        }
        Some(EntityLink::None) | Some(EntityLink::Case { .. }) => {}
        _ => match item.spec.as_ref() {
            CaseSpec::NodalStatic(s) => {
                if let Some(id) = s.existing_spc_set_id.filter(|v| *v > 0) {
                    ctx.allocator
                        .note_external(IdKind::Spc, id, Some("existing SPC set".into()));
                }
            }
            CaseSpec::Gravity(s) => {
                if let Some(id) = s.existing_spc_set_id.filter(|v| *v > 0) {
                    ctx.allocator
                        .note_external(IdKind::Spc, id, Some("existing SPC set".into()));
                }
            }
            CaseSpec::NormalModes(s) => {
                if let Some(id) = s.existing_spc_set_id.filter(|v| *v > 0) {
                    ctx.allocator
                        .note_external(IdKind::Spc, id, Some("existing SPC set".into()));
                }
            }
            CaseSpec::FrequencyResponse(s) if s.existing_spc_set_id > 0 => {
                ctx.allocator.note_external(
                    IdKind::Spc,
                    s.existing_spc_set_id,
                    Some("existing SPC set".into()),
                );
            }
            CaseSpec::RandomPsd(s) => {
                let id = match &s.excitation {
                    Excitation::BaseAcceleration {
                        existing_spc_set_id,
                        ..
                    } => *existing_spc_set_id,
                    Excitation::AppliedForce {
                        existing_spc_set_id,
                        ..
                    } => *existing_spc_set_id,
                };
                if id > 0 {
                    ctx.allocator
                        .note_external(IdKind::Spc, id, Some("existing SPC set".into()));
                }
            }
            _ => {}
        },
    }

    if let CaseSpec::Constraint(s) = item.spec.as_ref() {
        for id in &s.existing_spc_set_ids {
            if *id > 0 {
                ctx.allocator
                    .note_external(IdKind::Spc, *id, Some("existing SPC set".into()));
            }
        }
    }

    if let CaseSpec::FrequencyResponse(s) = item.spec.as_ref() {
        match &item.load_source {
            Some(EntityLink::External { id }) if *id > 0 => {
                ctx.allocator
                    .note_external(IdKind::Dload, *id, Some("existing DLOAD/RLOAD".into()));
            }
            None => {
                if let Some(id) = s.load_id.filter(|v| *v > 0) {
                    ctx.allocator
                        .note_external(IdKind::Dload, id, Some("existing DLOAD/RLOAD".into()));
                }
            }
            _ => {}
        }
    }
}

fn resolve_optional_spc(
    item: &MultiCaseItem,
    fallback: Option<u64>,
    constraint_outputs: &HashMap<String, ConstraintOutput>,
    ctx: &mut GenerationContext,
) -> (Option<u64>, bool) {
    match &item.spc_source {
        Some(EntityLink::None) => (None, false),
        Some(EntityLink::External { id }) => {
            if *id == 0 {
                ctx.error(
                    "LC-REF-001",
                    format!("工况「{}」的外部 SPC Set ID 必须为正整数", item_display_name(item)),
                );
                (None, false)
            } else {
                (Some(*id), true)
            }
        }
        Some(EntityLink::Case { case_id }) => match constraint_outputs.get(case_id) {
            Some(c) => match c.effective_spc_sid {
                Some(sid) => (Some(sid), false),
                None => {
                    ctx.error(
                        "LC-COMPAT-003",
                        format!(
                            "工况「{}」引用的约束工况未产生单一可用的 SPC 集合编号（仅引用多个外部集合时请启用 SPCADD 组合）",
                            item_display_name(item)
                        ),
                    );
                    (None, false)
                }
            },
            None => (None, false),
        },
        None => (fallback, fallback.is_some()),
    }
}

fn resolve_required_spc(
    item: &MultiCaseItem,
    fallback: u64,
    constraint_outputs: &HashMap<String, ConstraintOutput>,
    ctx: &mut GenerationContext,
) -> (u64, bool) {
    match &item.spc_source {
        Some(EntityLink::None) => {
            ctx.error(
                "LC-COMPAT-003",
                format!(
                    "工况「{}」必须绑定 SPC 约束集合（频响/随机振动不支持无约束）",
                    item_display_name(item)
                ),
            );
            (0, false)
        }
        Some(EntityLink::External { id }) => {
            if *id == 0 {
                ctx.error(
                    "LC-REF-001",
                    format!("工况「{}」的外部 SPC Set ID 必须为正整数", item_display_name(item)),
                );
                (0, true)
            } else {
                (*id, true)
            }
        }
        Some(EntityLink::Case { case_id }) => match constraint_outputs.get(case_id) {
            Some(c) => match c.effective_spc_sid {
                Some(sid) => (sid, false),
                None => {
                    ctx.error(
                        "LC-COMPAT-003",
                        format!(
                            "工况「{}」引用的约束工况未产生单一可用的 SPC 集合编号",
                            item_display_name(item)
                        ),
                    );
                    (0, false)
                }
            },
            None => (0, false),
        },
        None => {
            if fallback == 0 {
                ctx.error(
                    "LC-REF-001",
                    format!("工况「{}」缺少外部 SPC Set ID", item_display_name(item)),
                );
            }
            (fallback, true)
        }
    }
}

fn check_cross_family_id_collisions(frag: &DeckFragment, ctx: &mut GenerationContext) {
    let mut spc_sids: HashSet<u64> = HashSet::new();
    let mut spcadd_sids: HashSet<u64> = HashSet::new();
    let mut static_load_sids: HashSet<u64> = HashSet::new();
    let mut dload_sids: HashSet<u64> = HashSet::new();
    let mut rload_sids: HashSet<u64> = HashSet::new();
    let mut tabled_tids: HashSet<u64> = HashSet::new();
    let mut tabrnd_tids: HashSet<u64> = HashSet::new();
    let mut tabdmp_tids: HashSet<u64> = HashSet::new();
    let mut eigrl_sids: HashSet<u64> = HashSet::new();
    let mut eigra_sids: HashSet<u64> = HashSet::new();
    let mut freq1_sids: HashSet<u64> = HashSet::new();
    let mut freq2_sids: HashSet<u64> = HashSet::new();
    let mut freq_list_sids: HashSet<u64> = HashSet::new();

    for card in &frag.bulk_cards {
        match card {
            BulkCard::Spc { sid, .. } | BulkCard::Spc1 { sid, .. } => {
                spc_sids.insert(*sid);
            }
            BulkCard::SpcAdd { sid, .. } => {
                spcadd_sids.insert(*sid);
            }
            BulkCard::Force { sid, .. }
            | BulkCard::Moment { sid, .. }
            | BulkCard::Grav { sid, .. } => {
                static_load_sids.insert(*sid);
            }
            BulkCard::Dload { sid, .. } => {
                dload_sids.insert(*sid);
            }
            BulkCard::Rload1 { sid, .. } | BulkCard::Rload2 { sid, .. } => {
                rload_sids.insert(*sid);
            }
            BulkCard::Tabled1 { tid, .. } => {
                tabled_tids.insert(*tid);
            }
            BulkCard::Tabrnd1 { sid, .. } => {
                tabrnd_tids.insert(*sid);
            }
            BulkCard::Tabdmp1 { sid, .. } => {
                tabdmp_tids.insert(*sid);
            }
            BulkCard::Eigrl { sid, .. } => {
                eigrl_sids.insert(*sid);
            }
            BulkCard::Eigra { sid, .. } => {
                eigra_sids.insert(*sid);
            }
            BulkCard::Freq1 { sid, .. } => {
                freq1_sids.insert(*sid);
            }
            BulkCard::Freq2 { sid, .. } => {
                freq2_sids.insert(*sid);
            }
            BulkCard::FreqList { sid, .. } => {
                freq_list_sids.insert(*sid);
            }
            BulkCard::Spcd { .. } | BulkCard::Darea { .. } | BulkCard::Randps { .. } => {}
        }
    }

    let mut report_overlap = |a_name: &str, a: &HashSet<u64>, b_name: &str, b: &HashSet<u64>| {
        for id in a.intersection(b) {
            ctx.error(
                "LC-ID-002",
                format!("{a_name} 与 {b_name} 卡片共用了相同编号 {id}，OptiStruct 不允许同命名空间卡片编号重叠"),
            );
        }
    };

    report_overlap("SPC/SPC1", &spc_sids, "SPCADD", &spcadd_sids);
    report_overlap("FORCE/MOMENT/GRAV", &static_load_sids, "DLOAD", &dload_sids);
    report_overlap("FORCE/MOMENT/GRAV", &static_load_sids, "RLOAD1/2", &rload_sids);
    report_overlap("DLOAD", &dload_sids, "RLOAD1/2", &rload_sids);
    report_overlap("TABLED1", &tabled_tids, "TABRND1", &tabrnd_tids);
    report_overlap("TABLED1", &tabled_tids, "TABDMP1", &tabdmp_tids);
    report_overlap("TABRND1", &tabrnd_tids, "TABDMP1", &tabdmp_tids);
    report_overlap("EIGRL", &eigrl_sids, "EIGRA", &eigra_sids);
    report_overlap("FREQ1", &freq1_sids, "FREQ2", &freq2_sids);
    report_overlap("FREQ1", &freq1_sids, "FREQ", &freq_list_sids);
    report_overlap("FREQ2", &freq2_sids, "FREQ", &freq_list_sids);
}

pub fn generate(spec: &MultiCaseSpec) -> MultiCaseBuilt {
    let mut ctx = GenerationContext::new(
        &spec.solver,
        &spec.solver_version,
        &spec.model_units,
        spec.id_policy.clone(),
    );
    let mut frag = DeckFragment::new(101);

    if !spec.solver.trim().eq_ignore_ascii_case("optistruct") {
        ctx.error(
            "LC-COMPAT-002",
            format!(
                "多工况 FEM 组装仅支持同一求解器（当前仅开放 OptiStruct 2022），不支持目标求解器「{}」",
                spec.solver
            ),
        );
    } else if let Err(d) = ensure_supported(&spec.solver, &spec.solver_version) {
        ctx.diagnostics.push(d);
    }
    if let Err(d) = require_units(&spec.model_units) {
        ctx.diagnostics.push(d);
    }

    let enabled_items: Vec<&MultiCaseItem> = spec.cases.iter().filter(|c| c.enabled).collect();
    if enabled_items.is_empty() {
        ctx.error("LC-INPUT-001", "多工况工程至少需要保留并启用一个工况");
        return MultiCaseBuilt {
            built: BuiltCase::new(frag, ctx),
            points: Vec::new(),
        };
    }

    // Index all items by case_id for link validation.
    let mut item_by_id: HashMap<&str, &MultiCaseItem> = HashMap::new();
    for item in &spec.cases {
        if item.case_id.trim().is_empty() {
            ctx.error("LC-INPUT-001", "存在缺少 caseId 的工况条目");
            continue;
        }
        if item_by_id.insert(item.case_id.as_str(), item).is_some() {
            ctx.error(
                "LC-INPUT-001",
                format!("存在重复的工况标识 caseId: {}", item.case_id),
            );
        }
    }

    // Pre-validate compatibility & assign unique ASCII labels.
    let mut used_labels: HashMap<String, usize> = HashMap::new();
    let mut unique_labels: HashMap<String, String> = HashMap::new();

    for item in &enabled_items {
        let name = item_display_name(item);
        match item.spec.as_ref() {
            CaseSpec::RadiossRops(_) | CaseSpec::RadiossFops(_) => {
                ctx.error(
                    "LC-COMPAT-002",
                    format!(
                        "工况「{name}」为 Radioss 显式求解器格式（.rad），无法直接合入 OptiStruct .fem 模型"
                    ),
                );
            }
            CaseSpec::MultiCase(_) => {
                ctx.error("LC-COMPAT-002", "不支持嵌套多工况工程");
            }
            _ => {}
        }

        if let Some(units) = case_model_units(&item.spec) {
            if units != spec.model_units {
                ctx.error(
                    "LC-COMPAT-001",
                    format!(
                        "工况「{name}」的单位制（{units}）与工程统一单位制（{}）不一致，同模型禁止混用单位制",
                        spec.model_units
                    ),
                );
            }
        }

        if let Some((solver, ver)) = case_solver_and_version(&item.spec) {
            if !solver.eq_ignore_ascii_case(&spec.solver) {
                ctx.error(
                    "LC-COMPAT-002",
                    format!(
                        "工况「{name}」的求解器（{solver}）与工程目标求解器（{}）不同，组装只能针对同一个求解器",
                        spec.solver
                    ),
                );
            } else if ver != spec.solver_version {
                ctx.error(
                    "LC-COMPAT-001",
                    format!(
                        "工况「{name}」的求解器版本（{ver}）与工程目标版本（{}）不一致",
                        spec.solver_version
                    ),
                );
            }
        }

        // Validate SPC / Load cross-case links.
        if let Some(EntityLink::Case { case_id }) = &item.spc_source {
            match item_by_id.get(case_id.as_str()) {
                None => ctx.error(
                    "LC-COMPAT-003",
                    format!("工况「{name}」引用的工程约束工况不存在（{case_id}）"),
                ),
                Some(target) if !target.enabled => ctx.error(
                    "LC-COMPAT-003",
                    format!(
                        "工况「{name}」引用了已禁用的约束工况「{}」，请启用或更换 SPC 来源",
                        item_display_name(target)
                    ),
                ),
                Some(target) if !matches!(target.spec.as_ref(), CaseSpec::Constraint(_)) => {
                    ctx.error(
                        "LC-COMPAT-003",
                        format!(
                            "工况「{name}」的 SPC 来源指向了非约束工况「{}」",
                            item_display_name(target)
                        ),
                    );
                }
                _ => {}
            }
        }

        if let Some(EntityLink::Case { case_id }) = &item.load_source {
            match item_by_id.get(case_id.as_str()) {
                None => ctx.error(
                    "LC-COMPAT-003",
                    format!("工况「{name}」引用的静力载荷工况不存在（{case_id}）"),
                ),
                Some(target) if !target.enabled => ctx.error(
                    "LC-COMPAT-003",
                    format!(
                        "工况「{name}」引用了已禁用的载荷工况「{}」",
                        item_display_name(target)
                    ),
                ),
                Some(target) => match target.spec.as_ref() {
                    CaseSpec::NodalStatic(ns) if ns.per_row_subcase => ctx.error(
                        "LC-COMPAT-003",
                        format!(
                            "节点静力工况「{}」启用了逐行独立子工况，产生多个 LOAD 编号，无法直接作为单载荷引用",
                            item_display_name(target)
                        ),
                    ),
                    CaseSpec::Gravity(g) if g.cases.len() > 1 => ctx.error(
                        "LC-COMPAT-003",
                        format!(
                            "重力工况「{}」包含 {} 条重力子工况，产生多个 LOAD 编号，无法直接作为单载荷引用",
                            item_display_name(target),
                            g.cases.len()
                        ),
                    ),
                    CaseSpec::NodalStatic(_) | CaseSpec::Gravity(_) => {}
                    _ => ctx.error(
                        "LC-COMPAT-003",
                        format!(
                            "工况「{name}」的载荷来源指向了不支持的工况类型「{}」",
                            item_display_name(target)
                        ),
                    ),
                },
            }
        }

        let base = ascii_name(&name);
        let count = used_labels.entry(base.clone()).or_default();
        *count += 1;
        let final_label = if *count == 1 {
            base
        } else {
            let suffixed = format!("{base}_{}", *count);
            ctx.warn(
                "LC-COMPAT-005",
                format!("存在同名/同标签工况「{name}」，已自动为实体标签追加后缀「{suffixed}」以避免 HyperMesh 重名冲突"),
            );
            suffixed
        };
        unique_labels.insert(item.case_id.clone(), final_label);
    }

    // Pass 1: Pre-register all external IDs across all enabled cases so generated IDs automatically avoid them.
    for item in &enabled_items {
        register_external_spc_for_item(item, &mut ctx);
    }

    // Pass 2a: Generate all Constraint cases first so their SPC/SPCADD IDs are available.
    let mut constraint_outputs: HashMap<String, ConstraintOutput> = HashMap::new();
    for item in &enabled_items {
        if let CaseSpec::Constraint(s) = item.spec.as_ref() {
            let label = unique_labels.get(&item.case_id).map(String::as_str);
            let key_prefix = format!("{}::{}", item.case_id, s.name);
            let out = constraint::generate_into(s, &key_prefix, label, true, &mut ctx, &mut frag);
            constraint_outputs.insert(item.case_id.clone(), out);
        }
    }

    // Pass 2b: Generate NodalStatic, Gravity, TabularLoad, NormalModes, RandomPsd, and FrequencyResponse
    // (deferring FrequencyResponse that links to a project Load until Load cases are generated).
    let mut load_outputs: HashMap<String, u64> = HashMap::new();
    let mut deferred_freq_resp: Vec<&MultiCaseItem> = Vec::new();
    let mut all_tabular_points: Vec<PointEntry> = Vec::new();
    let mut tabular_case_count = 0usize;

    for item in &enabled_items {
        let label = unique_labels.get(&item.case_id).map(String::as_str);
        match item.spec.as_ref() {
            CaseSpec::Constraint(_) => {}
            CaseSpec::NodalStatic(s) => {
                let (spc, spc_ext) =
                    resolve_optional_spc(item, s.existing_spc_set_id, &constraint_outputs, &mut ctx);
                let mut effective = s.clone();
                effective.existing_spc_set_id = spc;
                let key_prefix = format!("{}::{}", item.case_id, s.name);
                if let Some(load_sid) = nodal_static::generate_into(
                    &effective,
                    &key_prefix,
                    label,
                    spc_ext,
                    &mut ctx,
                    &mut frag,
                ) {
                    load_outputs.insert(item.case_id.clone(), load_sid);
                }
            }
            CaseSpec::Gravity(s) => {
                let (spc, spc_ext) =
                    resolve_optional_spc(item, s.existing_spc_set_id, &constraint_outputs, &mut ctx);
                let mut effective = s.clone();
                effective.existing_spc_set_id = spc;
                let key_prefix = format!("{}::{}", item.case_id, s.name);
                if let Some(load_sid) =
                    gravity::generate_into(&effective, &key_prefix, label, spc_ext, &mut ctx, &mut frag)
                {
                    load_outputs.insert(item.case_id.clone(), load_sid);
                }
            }
            CaseSpec::NormalModes(s) => {
                let (spc, spc_ext) =
                    resolve_optional_spc(item, s.existing_spc_set_id, &constraint_outputs, &mut ctx);
                let mut effective = s.clone();
                effective.existing_spc_set_id = spc;
                let key_prefix = format!("{}::{}", item.case_id, s.name);
                normal_modes::generate_into(
                    &effective,
                    &key_prefix,
                    label,
                    spc_ext,
                    &mut ctx,
                    &mut frag,
                );
            }
            CaseSpec::FrequencyResponse(_) => {
                let needs_defer = match &item.load_source {
                    Some(EntityLink::Case { case_id }) => !load_outputs.contains_key(case_id),
                    _ => false,
                };
                if needs_defer {
                    deferred_freq_resp.push(item);
                } else {
                    emit_frequency_response(
                        item,
                        label,
                        &constraint_outputs,
                        &load_outputs,
                        &mut ctx,
                        &mut frag,
                    );
                }
            }
            CaseSpec::RandomPsd(s) => {
                let fallback_spc = match &s.excitation {
                    Excitation::BaseAcceleration {
                        existing_spc_set_id,
                        ..
                    } => *existing_spc_set_id,
                    Excitation::AppliedForce {
                        existing_spc_set_id,
                        ..
                    } => *existing_spc_set_id,
                };
                let (spc, spc_ext) =
                    resolve_required_spc(item, fallback_spc, &constraint_outputs, &mut ctx);
                let mut effective = s.clone();
                match &mut effective.excitation {
                    Excitation::BaseAcceleration {
                        existing_spc_set_id,
                        ..
                    } => *existing_spc_set_id = spc,
                    Excitation::AppliedForce {
                        existing_spc_set_id,
                        ..
                    } => *existing_spc_set_id = spc,
                }
                let key_prefix = format!("{}::{}", item.case_id, s.name);
                random_psd::generate_into(
                    &effective,
                    &key_prefix,
                    label,
                    spc_ext,
                    &mut ctx,
                    &mut frag,
                );
            }
            CaseSpec::TabularLoad(s) => {
                tabular_case_count += 1;
                if tabular_case_count > 1 {
                    ctx.warn(
                        "LC-COMPAT-NODE",
                        "工程中包含多个整车工况表条目，各自默认从节点 1001 起编号；请确认点位表合并或改用单一整车工况表",
                    );
                }
                let (spc, spc_ext) = resolve_optional_spc(item, None, &constraint_outputs, &mut ctx);
                if let (Some(id), true) = (spc, spc_ext) {
                    ctx.note_external(
                        IdKind::Spc,
                        id,
                        Some("existing SPC set".into()),
                        "tabular-load",
                    );
                }
                let key_prefix = format!("{}::{}", item.case_id, item_display_name(item));
                match load_deck::generate_tabular_into(s, &key_prefix, spc, &mut ctx, &mut frag) {
                    Ok(tab_out) => {
                        all_tabular_points.extend(tab_out.points);
                    }
                    Err(err) => {
                        ctx.error("LC-INPUT-001", format!("整车工况表「{}」：{err}", item_display_name(item)));
                    }
                }
            }
            CaseSpec::RadiossRops(_) | CaseSpec::RadiossFops(_) | CaseSpec::MultiCase(_) => {}
        }
    }

    for item in deferred_freq_resp {
        let label = unique_labels.get(&item.case_id).map(String::as_str);
        emit_frequency_response(
            item,
            label,
            &constraint_outputs,
            &load_outputs,
            &mut ctx,
            &mut frag,
        );
    }

    // Pass 3: Cross-case engineering compatibility checks.
    // 3a. Verify PSD BaseAcceleration DOF coverage against referenced internal Constraint case.
    for item in &enabled_items {
        if let CaseSpec::RandomPsd(s) = item.spec.as_ref() {
            if let (
                Some(EntityLink::Case { case_id }),
                Excitation::BaseAcceleration {
                    node_id, component, ..
                },
            ) = (&item.spc_source, &s.excitation)
            {
                if let Some(c_out) = constraint_outputs.get(case_id) {
                    if !c_out.constrained_node_dofs.is_empty() {
                        let axis = s.axis_mode.trim().to_ascii_uppercase().replace('_', "-");
                        let tri = matches!(
                            axis.as_str(),
                            "SEQUENTIAL-TRI" | "TRI" | "SEQUENTIAL-TRIAXIS"
                        );
                        let required: Vec<u32> = if tri { vec![1, 2, 3] } else { vec![*component] };
                        let covered = c_out.constrained_node_dofs.get(node_id);
                        let missing: Vec<u32> = required
                            .into_iter()
                            .filter(|d| !covered.is_some_and(|list| list.contains(d)))
                            .collect();
                        if !missing.is_empty() {
                            let target_name = item_by_id
                                .get(case_id.as_str())
                                .map(|t| item_display_name(t))
                                .unwrap_or_else(|| case_id.clone());
                            ctx.error(
                                "LC-COMPAT-004",
                                format!(
                                    "PSD 工况「{}」引用了工程约束「{target_name}」，但该约束未覆盖激励节点 {node_id} 的自由度 {:?}（SPCD 基座激励要求对应自由度被 SPC 固定）",
                                    s.name, missing
                                ),
                            );
                        }
                    }
                }
            }
        }
    }

    // 3b. Check node overlap when TabularLoad points (1001+) coexist with manual cases.
    if !all_tabular_points.is_empty() {
        let tab_nodes: BTreeSet<u64> = all_tabular_points.iter().map(|p| p.node_id).collect();
        let mut overlapped_nodes: BTreeMap<u64, Vec<String>> = BTreeMap::new();
        for ext in &ctx.external_refs {
            if ext.kind == IdKind::Node && tab_nodes.contains(&ext.id) {
                overlapped_nodes
                    .entry(ext.id)
                    .or_default()
                    .push(ext.used_by.clone());
            }
        }
        for (nid, users) in overlapped_nodes {
            let has_non_constraint = users.iter().any(|u| u != "constraint");
            if has_non_constraint {
                ctx.warn(
                    "LC-COMPAT-NODE",
                    format!(
                        "整车工况表分配的节点号 {nid} 同时被其他工况（{}）作为外部节点引用，请确认指向同一物理位置并先导入 _points.json",
                        users.join("、")
                    ),
                );
            } else {
                ctx.info(
                    "LC-COMPAT-NODE",
                    format!(
                        "约束工况已关联整车工况表点位节点 {nid}，导入 HyperMesh 时请先执行 _points.json 创建节点后再导入 .fem"
                    ),
                );
            }
        }
    }

    // 3c. Cross-family bulk card SID collision check.
    check_cross_family_id_collisions(&frag, &mut ctx);

    // 3d. Determine unified SOL number from all emitted subcases.
    let mut has_random = false;
    let mut has_mfreq = false;
    let mut has_modal = false;
    let mut has_statics = false;
    for sc in &frag.subcases {
        match sc.analysis.as_deref() {
            Some("RANDOM") => has_random = true,
            Some("MFREQ") => has_mfreq = true,
            Some("MODES") => has_modal = true,
            Some("STATICS") => has_statics = true,
            _ => {}
        }
    }
    let sol = if has_random || has_mfreq {
        111
    } else if has_modal {
        103
    } else {
        101
    };
    frag.sol = Some(sol);

    let mut kinds = Vec::new();
    if has_statics {
        kinds.push("STATICS");
    }
    if has_modal {
        kinds.push("MODES");
    }
    if has_mfreq {
        kinds.push("MFREQ");
    }
    if has_random {
        kinds.push("RANDOM");
    }
    if frag.subcases.is_empty() {
        ctx.info(
            "LC-MULTI-001",
            format!(
                "当前仅包含边界约束卡片（SOL {sol}，0 个 SUBCASE，{} 张卡片）；可导出用于前处理或继续添加静力/模态/动响应工况",
                frag.bulk_cards.len()
            ),
        );
    } else {
        ctx.info(
            "LC-MULTI-001",
            format!(
                "联合 FEM 组装完成：SOL {sol}，共 {} 个 SUBCASE（{}），{} 张 Bulk 卡片",
                frag.subcases.len(),
                kinds.join(" + "),
                frag.bulk_cards.len()
            ),
        );
    }

    MultiCaseBuilt {
        built: BuiltCase::new(frag, ctx),
        points: all_tabular_points,
    }
}

fn emit_frequency_response(
    item: &MultiCaseItem,
    label: Option<&str>,
    constraint_outputs: &HashMap<String, ConstraintOutput>,
    load_outputs: &HashMap<String, u64>,
    ctx: &mut GenerationContext,
    frag: &mut DeckFragment,
) {
    let CaseSpec::FrequencyResponse(s) = item.spec.as_ref() else {
        return;
    };
    let (spc, spc_ext) =
        resolve_required_spc(item, s.existing_spc_set_id, constraint_outputs, ctx);
    let key_prefix = format!("{}::{}", item.case_id, s.name);
    let (load_id, load_ext) = match &item.load_source {
        Some(EntityLink::None) => (None, false),
        Some(EntityLink::External { id }) => {
            if *id == 0 {
                ctx.error("LC-REF-001", format!("工况「{}」的外部 DLOAD/RLOAD ID 必须为正整数", s.name));
                (None, false)
            } else {
                (Some(*id), true)
            }
        }
        Some(EntityLink::Case { case_id }) => match load_outputs.get(case_id) {
            Some(static_sid) => {
                // Wrap internal static FORCE/MOMENT/GRAV SID in RLOAD2 + DLOAD so MFREQ uses valid DLOAD =.
                let rload_sid = ctx.allocate(IdKind::Rload, &format!("{key_prefix}#rload2"));
                let dload_sid = ctx.allocate(IdKind::Dload, &format!("{key_prefix}#dload"));
                frag.bulk_cards.push(BulkCard::Rload2 {
                    sid: rload_sid,
                    exciteid: *static_sid,
                    delay: None,
                    dphase: None,
                    tb: None,
                    tp: None,
                    rtype: "LOAD".into(),
                });
                frag.bulk_cards.push(BulkCard::Dload {
                    sid: dload_sid,
                    scale: 1.0,
                    components: vec![(1.0, rload_sid)],
                });
                (Some(dload_sid), false)
            }
            None => (None, false),
        },
        None => (s.load_id, s.load_id.is_some()),
    };

    let mut effective = s.clone();
    effective.existing_spc_set_id = spc;
    effective.load_id = load_id;
    frequency_response::generate_into(
        &effective,
        &key_prefix,
        label,
        spc_ext,
        load_ext,
        ctx,
        frag,
    );
}
