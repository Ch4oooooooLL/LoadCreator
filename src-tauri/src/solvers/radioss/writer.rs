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
use crate::solvers::radioss::format::{dof_code, e20, i10, t10};

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

fn write_engine(out: &mut String, card: &EngineCard) -> Result<(), Diagnostic> {
    match card {
        EngineCard::Run {
            name,
            number,
            t_stop,
        } => {
            line(out, &format!("/RUN/{name}/{number}"));
            line(out, &format!("{}", e20(*t_stop)?));
        }
        EngineCard::AnimationDt { t_start, t_freq } => {
            line(out, "/ANIM/DT");
            line(out, &format!("{} {}", e20(*t_start)?, e20(*t_freq)?));
        }
        EngineCard::TimeHistory { interval } => {
            line(out, "/TFILE");
            line(out, &format!("{}", e20(*interval)?));
        }
        EngineCard::NodalCst { scale, min_step } => {
            line(out, "/DT/NODA/CST");
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
            row.push_str(&t10("")?);
            row.push_str(&i10(*icoor as u64)?);
            line(out, &row);
            let mut row2 = String::new();
            row2.push_str(&e20(*a_scale)?);
            row2.push_str(&e20(*f_scale)?);
            row2.push_str(&match t_start {
                Some(v) => e20(*v)?,
                None => t10("")?.repeat(2),
            });
            row2.push_str(&match t_stop {
                Some(v) => e20(*v)?,
                None => t10("")?.repeat(2),
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
            row.push_str(&e20(*a_scale)?);
            row.push_str(&e20(*f_scale)?);
            line(out, &row);
        }
        StarterCard::Ams { part_group_id } => {
            line(out, "/AMS");
            line(out, &i10(*part_group_id)?);
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
    line(&mut out, "2022");
    line(&mut out, &input.input_units.join(" "));
    line(&mut out, &input.work_units.join(" "));

    for card in &input.deck.starter {
        write_starter(&mut out, card)?;
    }
    line(&mut out, "/END");
    Ok(out)
}
