//! OptiStruct 2022 free-field FEM writer.
//!
//! Responsibilities:
//!   * version/capability gate;
//!   * deterministic, order-stable text (no timestamps / randomness);
//!   * dedicated per-card serialisation with continuation for long tables;
//!   * strict float formatting (reject NaN/Inf, normalise -0);
//!   * ASCII entity names / labels; Chinese stays in the UI + companion JSON.

use crate::core::cards::{BulkCard, Rload2Tb};
use crate::core::deck_ir::{DeckFragment, Subcase};
use crate::core::diagnostics::Diagnostic;
use crate::solvers::optistruct::capabilities_2022::ensure_supported;
use crate::solvers::optistruct::hm_metadata;

#[derive(Debug, Clone)]
pub struct WriterOptions {
    pub include_hm_metadata: bool,
    /// Line ending: "\n" (default) or "\r\n".
    pub newline: String,
}

impl Default for WriterOptions {
    fn default() -> Self {
        Self {
            include_hm_metadata: true,
            newline: "\n".into(),
        }
    }
}

pub struct WriteInput<'a> {
    pub title: &'a str,
    pub solver: &'a str,
    pub solver_version: &'a str,
    pub fragment: &'a DeckFragment,
}

/// Format a finite float as a Nastran free-field real. Rejects NaN/Inf.
pub fn fmt_real(value: f64) -> Result<String, Diagnostic> {
    if !value.is_finite() {
        return Err(Diagnostic::error(
            "LC-DECK-001",
            "FEM 数值包含 NaN/Inf，拒绝生成",
        ));
    }
    if value == 0.0 {
        return Ok("0.0".into());
    }
    let mut text = format!("{value}");
    if text == "-0" {
        text = "0.0".into();
    }
    let has_sep = text.contains('.') || text.contains('e') || text.contains('E');
    if !has_sep {
        text.push_str(".0");
    }
    Ok(text)
}

fn ascii_label(value: &str) -> String {
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
        trimmed.chars().take(64).collect()
    }
}

fn push_int_token(tokens: &mut Vec<String>, value: u64) {
    tokens.push(value.to_string());
}

fn push_real_token(tokens: &mut Vec<String>, value: f64) -> Result<(), Diagnostic> {
    tokens.push(fmt_real(value)?);
    Ok(())
}

fn emit_continued(
    out: &mut String,
    card: &str,
    header: &[String],
    data: &[String],
    per_line: usize,
) {
    let mut lines: Vec<String> = Vec::new();
    let mut first = String::from(card);
    for token in header {
        first.push(',');
        first.push_str(token);
    }
    let mut idx = 0usize;
    let mut count = 0usize;
    while idx < data.len() && count < per_line {
        first.push(',');
        first.push_str(&data[idx]);
        idx += 1;
        count += 1;
    }
    lines.push(first);
    while idx < data.len() {
        let mut line = String::from("+");
        let mut c = 0usize;
        while idx < data.len() && c < per_line {
            line.push(',');
            line.push_str(&data[idx]);
            idx += 1;
            c += 1;
        }
        lines.push(line);
    }
    for (i, line) in lines.iter().enumerate() {
        out.push_str(line);
        if i + 1 < lines.len() {
            out.push(',');
        }
        out.push('\n');
    }
}

fn write_card(out: &mut String, card: &BulkCard) -> Result<(), Diagnostic> {
    let mut tokens: Vec<String> = Vec::new();
    match card {
        BulkCard::Force {
            sid,
            gid,
            cid,
            scale,
            f,
        } => {
            push_int_token(&mut tokens, *sid);
            push_int_token(&mut tokens, *gid);
            push_int_token(&mut tokens, *cid);
            push_real_token(&mut tokens, *scale)?;
            push_real_token(&mut tokens, f.x)?;
            push_real_token(&mut tokens, f.y)?;
            push_real_token(&mut tokens, f.z)?;
            out.push_str(&format!("FORCE,{}\n", tokens.join(",")));
        }
        BulkCard::Moment {
            sid,
            gid,
            cid,
            scale,
            m,
        } => {
            push_int_token(&mut tokens, *sid);
            push_int_token(&mut tokens, *gid);
            push_int_token(&mut tokens, *cid);
            push_real_token(&mut tokens, *scale)?;
            push_real_token(&mut tokens, m.x)?;
            push_real_token(&mut tokens, m.y)?;
            push_real_token(&mut tokens, m.z)?;
            out.push_str(&format!("MOMENT,{}\n", tokens.join(",")));
        }
        BulkCard::Grav { sid, cid, scale, n } => {
            push_int_token(&mut tokens, *sid);
            push_int_token(&mut tokens, *cid);
            push_real_token(&mut tokens, *scale)?;
            push_real_token(&mut tokens, n.x)?;
            push_real_token(&mut tokens, n.y)?;
            push_real_token(&mut tokens, n.z)?;
            out.push_str(&format!("GRAV,{}\n", tokens.join(",")));
        }
        BulkCard::Spc { sid, gid, c, d } => {
            push_int_token(&mut tokens, *sid);
            push_int_token(&mut tokens, *gid);
            tokens.push(c.clone());
            push_real_token(&mut tokens, *d)?;
            out.push_str(&format!("SPC,{}\n", tokens.join(",")));
        }
        BulkCard::Spc1 {
            sid,
            ps,
            c,
            dofs,
            nodes,
        } => {
            push_int_token(&mut tokens, *sid);
            tokens.push(ps.clone());
            tokens.push(c.clone());
            tokens.push(dofs.clone());
            for node in nodes {
                push_int_token(&mut tokens, *node);
            }
            out.push_str(&format!("SPC1,{}\n", tokens.join(",")));
        }
        BulkCard::SpcAdd { sid, sets } => {
            push_int_token(&mut tokens, *sid);
            for set in sets {
                push_int_token(&mut tokens, *set);
            }
            out.push_str(&format!("SPCADD,{}\n", tokens.join(",")));
        }
        BulkCard::Eigrl { sid, nd, v1, v2 } => {
            push_int_token(&mut tokens, *sid);
            tokens.push(nd.map(|v| v.to_string()).unwrap_or_default());
            tokens.push(match v1 {
                Some(v) => fmt_real(*v)?,
                None => String::new(),
            });
            tokens.push(match v2 {
                Some(v) => fmt_real(*v)?,
                None => String::new(),
            });
            out.push_str(&format!("EIGRL,{}\n", tokens.join(",")));
        }
        BulkCard::Freq1 { sid, f1, df, nd } => {
            push_int_token(&mut tokens, *sid);
            push_real_token(&mut tokens, *f1)?;
            push_real_token(&mut tokens, *df)?;
            push_int_token(&mut tokens, *nd);
            out.push_str(&format!("FREQ1,{}\n", tokens.join(",")));
        }
        BulkCard::Tabdmp1 {
            sid,
            xaxis,
            yaxis,
            pairs,
        } => {
            let header = vec![sid.to_string(), xaxis.clone(), yaxis.clone()];
            let mut data = Vec::with_capacity(pairs.len() * 2);
            for (f, g) in pairs {
                data.push(fmt_real(*f)?);
                data.push(fmt_real(*g)?);
            }
            emit_continued(out, "TABDMP1", &header, &data, 8);
        }
        BulkCard::Rload2 {
            sid,
            exciteid,
            delay,
            dphase,
            tb,
            tp,
            rtype,
        } => {
            push_int_token(&mut tokens, *sid);
            push_int_token(&mut tokens, *exciteid);
            tokens.push(match delay {
                Some(v) => fmt_real(*v)?,
                None => String::new(),
            });
            tokens.push(match dphase {
                Some(v) => fmt_real(*v)?,
                None => String::new(),
            });
            tokens.push(match tb {
                Some(Rload2Tb::Constant(v)) => fmt_real(*v)?,
                Some(Rload2Tb::Table(id)) => id.to_string(),
                None => String::new(),
            });
            tokens.push(match tp {
                Some(v) => fmt_real(*v)?,
                None => String::new(),
            });
            tokens.push(rtype.clone());
            out.push_str(&format!("RLOAD2,{}\n", tokens.join(",")));
        }
        BulkCard::Dload {
            sid,
            scale,
            components,
        } => {
            let header = vec![sid.to_string(), fmt_real(*scale)?];
            let mut data = Vec::with_capacity(components.len() * 2);
            for (s, load) in components {
                data.push(fmt_real(*s)?);
                data.push(load.to_string());
            }
            emit_continued(out, "DLOAD", &header, &data, 8);
        }
        BulkCard::Spcd {
            sid,
            gid,
            component,
            d,
        } => {
            push_int_token(&mut tokens, *sid);
            push_int_token(&mut tokens, *gid);
            push_int_token(&mut tokens, *component as u64);
            push_real_token(&mut tokens, *d)?;
            out.push_str(&format!("SPCD,{}\n", tokens.join(",")));
        }
        BulkCard::Darea {
            sid,
            gid,
            component,
            a,
        } => {
            push_int_token(&mut tokens, *sid);
            push_int_token(&mut tokens, *gid);
            push_int_token(&mut tokens, *component as u64);
            push_real_token(&mut tokens, *a)?;
            out.push_str(&format!("DAREA,{}\n", tokens.join(",")));
        }
        BulkCard::Tabrnd1 {
            sid,
            xaxis,
            yaxis,
            points,
        } => {
            let header = vec![sid.to_string(), xaxis.clone(), yaxis.clone()];
            let mut data = Vec::with_capacity(points.len() * 2);
            for (f, p) in points {
                data.push(fmt_real(*f)?);
                data.push(fmt_real(*p)?);
            }
            emit_continued(out, "TABRND1", &header, &data, 8);
        }
        BulkCard::Randps {
            sid,
            j,
            k,
            x,
            y,
            tid,
        } => {
            push_int_token(&mut tokens, *sid);
            push_int_token(&mut tokens, *j);
            push_int_token(&mut tokens, *k);
            push_real_token(&mut tokens, *x)?;
            push_real_token(&mut tokens, *y)?;
            push_int_token(&mut tokens, *tid);
            out.push_str(&format!("RANDPS,{}\n", tokens.join(",")));
        }
    }
    Ok(())
}

fn write_subcase(out: &mut String, subcase: &Subcase) -> Result<(), Diagnostic> {
    out.push_str(&format!("SUBCASE {}\n", subcase.id));
    out.push_str(&format!("  LABEL = {}\n", ascii_label(&subcase.label)));
    if let Some(analysis) = &subcase.analysis {
        out.push_str(&format!("  ANALYSIS = {analysis}\n"));
    }
    if let Some(spc) = subcase.spc {
        out.push_str(&format!("  SPC = {spc}\n"));
    }
    if let Some(load) = subcase.load {
        out.push_str(&format!("  LOAD = {load}\n"));
    }
    if let Some(method) = subcase.method {
        out.push_str(&format!("  METHOD = {method}\n"));
    }
    if let Some(freq) = subcase.freq {
        out.push_str(&format!("  FREQ = {freq}\n"));
    }
    if let Some(sdamping) = subcase.sdamping {
        out.push_str(&format!("  SDAMPING = {sdamping}\n"));
    }
    if let Some(dload) = subcase.dload {
        out.push_str(&format!("  DLOAD = {dload}\n"));
    }
    if let Some(random) = subcase.random {
        out.push_str(&format!("  RANDOM = {random}\n"));
    }
    if let Some((kind, id)) = &subcase.statsub {
        out.push_str(&format!("  STATSUB({kind}) = {id}\n"));
    }
    for output in &subcase.outputs {
        out.push_str(&format!("  {output}\n"));
    }
    Ok(())
}

/// Render a complete incremental FEM deck.
pub fn write_fem(input: &WriteInput, options: &WriterOptions) -> Result<String, Diagnostic> {
    ensure_supported(input.solver, input.solver_version)?;

    let sol = input
        .fragment
        .sol
        .ok_or_else(|| Diagnostic::error("LC-DECK-001", "缺少执行控制 SOL 编号，无法生成 deck"))?;

    let mut out = String::new();
    out.push_str("$ Generated by LoadCreator 2.0\n");
    out.push_str(&format!(
        "$ Solver: {} {}\n",
        input.solver, input.solver_version
    ));
    out.push_str(&format!("$ Project: {}\n", ascii_label(input.title)));
    out.push_str(
        "$ Incremental deck: new loads / solve control only; no GRID/material/property/element.\n",
    );
    out.push_str(&format!("SOL {sol}\n"));
    out.push_str("CEND\n");
    out.push_str(&format!("TITLE = {}\n", ascii_label(input.title)));

    for subcase in &input.fragment.subcases {
        write_subcase(&mut out, subcase)?;
    }

    out.push_str("BEGIN BULK\n");
    if options.include_hm_metadata && !input.fragment.metadata.is_empty() {
        out.push_str(&hm_metadata::render(&input.fragment.metadata));
    }
    for card in &input.fragment.bulk_cards {
        write_card(&mut out, card)?;
    }
    out.push_str("ENDDATA\n");

    if options.newline != "\n" {
        out = out.replace('\n', &options.newline);
    }
    Ok(out)
}
