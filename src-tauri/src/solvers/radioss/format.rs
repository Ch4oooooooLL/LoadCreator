//! Fixed-field formatters for Radioss 2022 cards.
//!
//! Radioss block keywords use 10-character integer fields and 20-character real
//! fields. Every real is checked for NaN/Inf and for field-width overflow; an
//! overflow aborts with LC-DECK-001 instead of being silently truncated (SPEC 5.3).

use crate::core::diagnostics::Diagnostic;

/// Format a finite real. Rejects NaN/Inf. Keeps a decimal point so Radioss reads
/// it as a real, not an integer.
pub fn fmt_real(value: f64) -> Result<String, Diagnostic> {
    if !value.is_finite() {
        return Err(Diagnostic::error(
            "LC-DECK-001",
            "Raidoss 数值包含 NaN/Inf，拒绝生成",
        ));
    }
    if value == 0.0 {
        return Ok("0.0".into());
    }
    let mut text = if value.abs() < 1.0e-4 || value.abs() >= 1.0e7 {
        format!("{value:.6e}")
    } else {
        format!("{value}")
    };
    if text == "-0" {
        text = "0.0".into();
    }
    let has_sep = text.contains('.') || text.contains('e') || text.contains('E');
    if !has_sep {
        text.push_str(".0");
    }
    Ok(text)
}

/// Right-justify an integer into a field of the given width.
pub fn int_field(width: usize, value: u64) -> Result<String, Diagnostic> {
    let text = value.to_string();
    if text.len() > width {
        return Err(Diagnostic::error(
            "LC-DECK-001",
            format!("整数 {value} 超出 {width} 字符字段"),
        ));
    }
    Ok(format!("{:>width$}", text, width = width))
}

/// Right-justify a token (e.g. a direction letter or a DOF code) into a field.
pub fn text_field(width: usize, value: &str) -> Result<String, Diagnostic> {
    if value.chars().count() > width {
        return Err(Diagnostic::error(
            "LC-DECK-001",
            format!("字段值 “{value}” 超出 {width} 字符"),
        ));
    }
    Ok(format!("{:>width$}", value, width = width))
}

/// Right-justify a real into a field of the given width.
pub fn real_field(width: usize, value: f64) -> Result<String, Diagnostic> {
    let text = fmt_real(value)?;
    if text.chars().count() > width {
        return Err(Diagnostic::error(
            "LC-DECK-001",
            format!("实数 {text} 超出 {width} 字符字段"),
        ));
    }
    Ok(format!("{:>width$}", text, width = width))
}

pub fn i10(value: u64) -> Result<String, Diagnostic> {
    int_field(10, value)
}
pub fn t10(value: &str) -> Result<String, Diagnostic> {
    text_field(10, value)
}
pub fn e20(value: f64) -> Result<String, Diagnostic> {
    real_field(20, value)
}

/// Six DOF booleans -> right-justified 10-char Trarot code (SPEC /BCS).
pub fn dof_code(dofs: &[bool; 6]) -> String {
    dofs.iter()
        .map(|fixed| if *fixed { '1' } else { '0' })
        .collect()
}
