//! Radioss 2022 Single File Input composer.
//!
//! Layout (SPEC 3.1 / official Single File Input):
//!   # RADIOSS
//!   <Engine cards>            (must come first)
//!   /END/ENGINE
//!   # ---- Starter increment ----
//!   /BEGIN ... /END           (Starter cards)
//!
//! The deck is deterministic (no timestamps) and ASCII-only. It contains no
//! /NODE or mesh: only references to existing model node ids.
//!
//! IMPORTANT: HyperMesh 2023.0 append-import behaviour (P0-A/B/C) has NOT been
//! verified in this environment. The generated file is therefore marked
//! UNVERIFIED_HM_IMPORT and must not be presented as production-ready.

use crate::core::diagnostics::Diagnostic;
use crate::core::radioss_deck::{EngineCard, RadiossDeck, StarterCard};
use crate::solvers::radioss::capabilities_2022::ensure_supported;
use crate::solvers::radioss::format::{dof_code, e20, i10, i10_i32, t10};

const BLANK10: &str = "          ";
const BLANK20: &str = "                    ";

pub struct RadiossWriteInput<'a> {
    pub solver: &'a str,
    pub solver_version: &'a str,
    pub run_name: &'a str,
    pub input_units: [String; 3],
    pub work_units: [String; 3],
    pub deck: &'a RadiossDeck,
}

fn line(out: &mut String, text: &str) {
    out.push_str(text);
    out.push('\n');
}

fn format_th_vars(vars: &[String]) -> Result<String, Diagnostic> {
    if vars.is_empty() || vars.len() > 10 {
        return Err(Diagnostic::error(
            "LC-DECK-001",
            "Radioss /TH 输出变量数量必须在 1 到 10 个之间",
        ));
    }
    let mut row = String::new();
    for (idx, var) in vars.iter().enumerate() {
        let token = var.trim();
        if token.is_empty() || token.len() > 8 || !token.is_ascii() {
            return Err(Diagnostic::error(
                "LC-DECK-001",
                format!("Radioss /TH 变量名“{token}”非法（必须为 1–8 个 ASCII 字符）"),
            ));
        }
        if idx + 1 == vars.len() {
            row.push_str(token);
        } else {
            row.push_str(&format!("{token:<10}"));
        }
    }
    Ok(row)
}

fn map_anim_elem_suffix(option: &str) -> String {
    match option.trim().to_ascii_uppercase().as_str() {
        "LAW51_ALL" => "LAW51/ALL".into(),
        "LAW51_1" => "LAW51/1".into(),
        "LAW51_2" => "LAW51/2".into(),
        "LAW51_3" => "LAW51/3".into(),
        "LAW51_4" => "LAW51/4".into(),
        "ENERGY" => "ENER".into(),
        "PRES" => "P".into(),
        "THICK" => "THIC".into(),
        other => other.into(),
    }
}

fn write_engine(out: &mut String, card: &EngineCard) -> Result<(), Diagnostic> {
    match card {
        EngineCard::Vers { version } => {
            line(out, &format!("/VERS/{version}"));
        }
        EngineCard::Run {
            name,
            number,
            t_stop,
        } => {
            line(out, &format!("/RUN/{name}/{number}"));
            line(out, &format!("{}", e20(*t_stop)?));
        }
        EngineCard::Parith { on } => {
            line(out, if *on { "/PARITH/ON" } else { "/PARITH/OFF" });
        }
        EngineCard::Print { n_print, n_line } => {
            if *n_line == 0 {
                line(out, &format!("/PRINT/{n_print}"));
            } else {
                line(out, &format!("/PRINT/{n_print}/{n_line}"));
            }
        }
        EngineCard::AnimationDt { t_start, t_freq } => {
            line(out, "/ANIM/DT");
            line(out, &format!("{} {}", e20(*t_start)?, e20(*t_freq)?));
        }
        EngineCard::AnimElem { option } => {
            if option.starts_with("TRUSS/") || option.starts_with("BRICK/") {
                line(out, &format!("/ANIM/{option}"));
            } else {
                let suffix = map_anim_elem_suffix(option);
                line(out, &format!("/ANIM/ELEM/{suffix}"));
            }
        }
        EngineCard::AnimNoda { option } => {
            line(out, &format!("/ANIM/NODA/{}", option.trim().to_ascii_uppercase()));
        }
        EngineCard::AnimVect { option } => {
            line(out, &format!("/ANIM/VECT/{}", option.trim().to_ascii_uppercase()));
        }
        EngineCard::TimeHistory { file_type, interval } => {
            match file_type {
                None | Some(0) => line(out, "/TFILE"),
                Some(t) => line(out, &format!("/TFILE/{t}")),
            }
            line(out, &format!("{}", e20(*interval)?));
        }
        EngineCard::TimeHistoryVersion { version } => line(out, &format!("/TH/VERS/{version}")),
        EngineCard::NodalCst { scale, min_step } => {
            line(out, "/DT/NODA/CST/0");
            line(out, &format!("{} {}", e20(*scale)?, e20(*min_step)?));
        }
        EngineCard::AmsDt { scale, min_step } => {
            line(out, "/DT/AMS");
            line(out, &format!("{} {}", e20(*scale)?, e20(*min_step)?));
        }
    }
    Ok(())
}

fn write_starter(out: &mut String, card: &StarterCard) -> Result<(), Diagnostic> {
    match card {
        StarterCard::NodeGroup { id, title, node_ids } => {
            line(out, &format!("/GRNOD/NODE/{id}"));
            line(out, title);
            for chunk in node_ids.chunks(10) {
                let mut row = String::new();
                for node in chunk {
                    row.push_str(&i10(*node)?);
                }
                line(out, &row);
            }
        }
        StarterCard::Function { id, title, points } => {
            line(out, &format!("/FUNCT/{id}"));
            line(out, title);
            for (x, y) in points {
                line(out, &format!("{}{}", e20(*x)?, e20(*y)?));
            }
        }
        StarterCard::ImposedDisplacement {
            id,
            title,
            function_id,
            direction,
            skew_id,
            sensor_id,
            group_id,
            icoor,
            a_scale,
            f_scale,
            t_start,
            t_stop,
        } => {
            line(out, &format!("/IMPDISP/{id}"));
            line(out, title);
            // col1 fct, col2 Dir (right-justified), col3 skew, col4 sensor,
            // col5 grnd, col6 blank, col7 icoor.
            let mut row = String::new();
            row.push_str(&i10(*function_id)?);
            row.push_str(&t10(direction)?);
            row.push_str(&i10(*skew_id)?);
            row.push_str(&i10(*sensor_id)?);
            row.push_str(&i10(*group_id)?);
            row.push_str(BLANK10);
            row.push_str(&i10(*icoor as u64)?);
            line(out, &row);
            let mut row2 = String::new();
            row2.push_str(&e20(*a_scale)?);
            row2.push_str(&e20(*f_scale)?);
            row2.push_str(&match t_start {
                Some(v) => e20(*v)?,
                None => BLANK20.to_owned(),
            });
            row2.push_str(&match t_stop {
                Some(v) => e20(*v)?,
                None => BLANK20.to_owned(),
            });
            line(out, &row2);
        }
        StarterCard::Boundary {
            id,
            title,
            dofs,
            skew_id,
            group_id,
        } => {
            line(out, &format!("/BCS/{id}"));
            line(out, title);
            let mut row = String::new();
            row.push_str(&t10(&dof_code(dofs))?);
            row.push_str(&i10(*skew_id)?);
            row.push_str(&i10(*group_id)?);
            line(out, &row);
        }
        StarterCard::Gravity {
            id,
            title,
            function_id,
            direction,
            skew_id,
            sensor_id,
            group_id,
            a_scale,
            f_scale,
        } => {
            line(out, &format!("/GRAV/{id}"));
            line(out, title);
            let mut row = String::new();
            row.push_str(&i10(*function_id)?);
            row.push_str(&t10(direction)?);
            row.push_str(&i10(*skew_id)?);
            row.push_str(&i10(*sensor_id)?);
            row.push_str(&i10(*group_id)?);
            row.push_str(BLANK10);
            row.push_str(&e20(*a_scale)?);
            row.push_str(&e20(*f_scale)?);
            line(out, &row);
        }
        StarterCard::Ams { part_group_id } => {
            line(out, "/AMS");
            line(out, &i10(*part_group_id)?);
        }
        StarterCard::SkewFix {
            id,
            title,
            origin,
            y_axis,
            z_axis,
        } => {
            line(out, &format!("/SKEW/FIX/{id}"));
            line(out, title);
            line(out, &format!("{}{}{}", e20(origin[0])?, e20(origin[1])?, e20(origin[2])?));
            line(out, &format!("{}{}{}", e20(y_axis[0])?, e20(y_axis[1])?, e20(y_axis[2])?));
            line(out, &format!("{}{}{}", e20(z_axis[0])?, e20(z_axis[1])?, e20(z_axis[2])?));
        }
        StarterCard::InterType7 {
            id,
            title,
            slave_grnod_id,
            master_surf_id,
            istf,
            ithe,
            igap,
            ibag,
            idel,
            icurv,
            iadm,
            curv_node_id1,
            curv_node_id2,
            fscale_gap,
            gap_max,
            fpenmax,
            i_tied,
            st_min,
            st_max,
            percent_mesh_size,
            dtmin,
            irem_gap,
            irem_i2,
            stfac,
            fric,
            gap_min,
            t_start,
            t_stop,
            ibc,
            inacti,
            vis_s,
            vis_f,
            bumult,
            ifric,
            ifiltr,
            xfreq,
            iform,
            sens_id,
            fct_id_f,
            ascale_f,
            fric_id,
            c1,
            c2,
            c3,
            c4,
            c5,
            c6,
            thermal,
        } => {
            if *ithe == 1 && thermal.is_none() {
                return Err(Diagnostic::error("LC-DECK-001", "/INTER/TYPE7 Ithe=1 缺少热接触续行"));
            }
            line(out, &format!("/INTER/TYPE7/{id}"));
            line(out, title);
            line(
                out,
                "# grnd_IDs  surf_IDm      Istf      Ithe      Igap                Ibag      Idel     Icurv      Iadm",
            );
            line(
                out,
                &format!(
                    "{}{}{}{}{}{BLANK10}{}{}{}{}",
                    i10(*slave_grnod_id)?,
                    i10(*master_surf_id)?,
                    i10_i32(*istf)?,
                    i10_i32(*ithe)?,
                    i10_i32(*igap)?,
                    i10_i32(*ibag)?,
                    i10_i32(*idel)?,
                    i10_i32(*icurv)?,
                    i10_i32(*iadm)?,
                ),
            );
            line(
                out,
                "#         Fscale_gap              Gapmax             Fpenmax                        I_TIED",
            );
            line(
                out,
                &format!(
                    "{}{}{}{BLANK20}{}",
                    e20(*fscale_gap)?,
                    e20(*gap_max)?,
                    e20(*fpenmax)?,
                    i10_i32(*i_tied)?,
                ),
            );
            line(
                out,
                "#              Stmin               Stmax          %mesh_size               dtmin  Irem_gap   Irem_i2",
            );
            line(
                out,
                &format!(
                    "{}{}{}{}{}{}",
                    e20(*st_min)?,
                    e20(*st_max)?,
                    e20(*percent_mesh_size)?,
                    e20(*dtmin)?,
                    i10_i32(*irem_gap)?,
                    i10_i32(*irem_i2)?,
                ),
            );
            if *icurv == 1 || *icurv == 2 {
                line(out, "# node_ID1  node_ID2");
                line(
                    out,
                    &format!(
                        "{}{}",
                        i10(curv_node_id1.unwrap_or(0))?,
                        i10(curv_node_id2.unwrap_or(0))?,
                    ),
                );
            }
            line(
                out,
                "#              Stfac                Fric              Gapmin              Tstart               Tstop",
            );
            line(
                out,
                &format!(
                    "{}{}{}{}{}",
                    e20(*stfac)?,
                    e20(*fric)?,
                    e20(*gap_min)?,
                    e20(*t_start)?,
                    e20(*t_stop)?,
                ),
            );
            line(
                out,
                "#      IBC                        Inacti                VisS                VisF              Bumult",
            );
            line(
                out,
                &format!(
                    "{}{BLANK20}{}{}{}{}",
                    t10(ibc)?,
                    i10_i32(*inacti)?,
                    e20(*vis_s)?,
                    e20(*vis_f)?,
                    e20(*bumult)?,
                ),
            );
            line(
                out,
                "#    Ifric    Ifiltr               Xfreq     Iform   sens_ID   fct_IDf            Ascale_F   fric_ID",
            );
            line(
                out,
                &format!(
                    "{}{}{}{}{}{}{}{}",
                    i10_i32(*ifric)?,
                    i10_i32(*ifiltr)?,
                    e20(*xfreq)?,
                    i10_i32(*iform)?,
                    i10(*sens_id)?,
                    i10(*fct_id_f)?,
                    e20(*ascale_f)?,
                    i10(*fric_id)?,
                ),
            );
            if *ifric > 0 {
                line(
                    out,
                    "#                 C1                  C2                  C3                  C4                  C5",
                );
                line(
                    out,
                    &format!(
                        "{}{}{}{}{}",
                        e20(*c1)?,
                        e20(*c2)?,
                        e20(*c3)?,
                        e20(*c4)?,
                        e20(*c5)?,
                    ),
                );
                if *ifric > 1 {
                    line(out, "#                 C6");
                    line(out, &e20(*c6)?);
                }
            }
            if let Some(heat) = thermal.as_ref().filter(|_| *ithe == 1) {
                line(out, "#               Kthe  fct_ID_K                          Tint  Itheform            Ascale_K");
                line(out, &format!("{}{}{BLANK10}{}{}{}",
                    e20(heat.coefficient)?, i10(heat.function_id)?, e20(heat.interface_temperature)?,
                    i10_i32(heat.formulation)?, e20(heat.pressure_scale)?,
                ));
                line(out, "#               Frad                Drad             Fheat_s             Fheat_m");
                line(out, &format!("{}{}{}{}",
                    e20(heat.radiation_factor)?, e20(heat.radiation_distance)?,
                    e20(heat.secondary_friction_heat)?, e20(heat.main_friction_heat)?,
                ));
            }
        }
        StarterCard::TimeHistoryNode {
            id,
            title,
            variables,
            nodes,
        } => {
            line(out, &format!("/TH/NODE/{id}"));
            line(out, title);
            line(out, &format_th_vars(variables)?);
            for (node_id, skew_id, label) in nodes {
                let mut row = format!("{}{}", i10(*node_id)?, i10(*skew_id)?);
                let clean = label.trim();
                if !clean.is_empty() {
                    row.push_str(&clean.chars().take(80).collect::<String>());
                }
                line(out, &row);
            }
        }
        StarterCard::TimeHistoryElement {
            kind,
            id,
            title,
            variables,
            elements,
        } => {
            line(out, &format!("/TH/{kind}/{id}"));
            line(out, title);
            line(out, &format_th_vars(variables)?);
            for (elem_id, label) in elements {
                let mut row = format!("{}{BLANK10}", i10(*elem_id)?);
                let clean = label.trim();
                if !clean.is_empty() {
                    row.push_str(&clean.chars().take(80).collect::<String>());
                }
                line(out, &row);
            }
        }
        StarterCard::TimeHistoryObject {
            kind,
            id,
            title,
            variables,
            object_ids,
        } => {
            line(out, &format!("/TH/{kind}/{id}"));
            line(out, title);
            line(out, &format_th_vars(variables)?);
            if object_ids.is_empty() {
                line(out, &i10(0)?);
            } else {
                for chunk in object_ids.chunks(10) {
                    let mut row = String::new();
                    for obj in chunk {
                        row.push_str(&i10(*obj)?);
                    }
                    line(out, &row);
                }
            }
        }
    }
    Ok(())
}

/// Serialise a complete Radioss single-file increment.
pub fn write_rad(input: &RadiossWriteInput) -> Result<String, Diagnostic> {
    ensure_supported(input.solver, input.solver_version)?;

    let mut out = String::new();
    line(&mut out, "# RADIOSS");
    line(
        &mut out,
        "# Generated by LoadCreator 2.0 (Radioss 2022 single-file increment)",
    );
    line(
        &mut out,
        "# STATUS: UNVERIFIED_HM_IMPORT - HyperMesh 2023.0 append-import (P0-A/B/C) not executed.",
    );
    line(
        &mut out,
        "# Incremental case: no /NODE and no mesh; references existing model node ids only.",
    );

    for card in &input.deck.engine {
        write_engine(&mut out, card)?;
    }
    line(&mut out, "/END/ENGINE");
    line(&mut out, "# ---- Starter increment ----");
    line(&mut out, "/BEGIN");
    line(&mut out, input.run_name);
    line(&mut out, &i10(2022)?);
    for units in [&input.input_units, &input.work_units] {
        let mass_code = units[0].trim().to_ascii_lowercase();
        let mass = match mass_code.as_str() {
            "t" | "tonne" => "Mg",
            _ => mass_code.as_str(),
        };
        let length = units[1].trim().to_ascii_lowercase();
        let time = units[2].trim().to_ascii_lowercase();
        line(&mut out, &format!("{mass:>20}{length:>20}{time:>20}"));
    }

    for card in &input.deck.starter {
        write_starter(&mut out, card)?;
    }
    line(&mut out, "/END");
    Ok(out)
}
