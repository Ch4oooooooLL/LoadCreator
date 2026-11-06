//! Small reusable validation helpers.

use crate::core::diagnostics::Diagnostic;
use crate::core::units::UnitSystem;

/// Validate a model-unit string, returning the parsed system or a diagnostic.
pub fn require_units(units: &str) -> Result<UnitSystem, Diagnostic> {
    UnitSystem::parse(units).ok_or_else(|| {
        Diagnostic::error("LC-UNIT-001", format!("无法识别的模型单位制“{units}”"))
            .hint("支持 N-mm-s 或 N-m-s；请显式声明单位，求解器不定义默认单位")
    })
}

/// Reject non-finite values.
pub fn require_finite(value: f64, field: &str, label: &str) -> Result<(), Diagnostic> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(
            Diagnostic::error("LC-INPUT-001", format!("{label} 不是有限数值（NaN/Inf）"))
                .field(field),
        )
    }
}

/// DOF must be one of 1..=6.
pub fn require_dofs(dofs: &[u32], field: &str) -> Result<(), Diagnostic> {
    if dofs.is_empty() {
        return Err(Diagnostic::error("LC-INPUT-001", "至少需要一个自由度").field(field));
    }
    if let Some(bad) = dofs.iter().find(|d| **d < 1 || **d > 6) {
        return Err(
            Diagnostic::error("LC-INPUT-001", format!("自由度 {bad} 非法，必须为 1–6"))
                .field(field),
        );
    }
    Ok(())
}
