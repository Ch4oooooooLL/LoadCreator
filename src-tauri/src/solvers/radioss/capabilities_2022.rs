//! Radioss 2022 capability gate.
//!
//! Only the Radioss profile is accepted here. Unknown versions are rejected with
//! LC-COMPAT-001 rather than silently downgraded. This gate is deliberately
//! independent from the OptiStruct gate.

use crate::core::diagnostics::Diagnostic;

pub const SUPPORTED_SOLVER_VERSION: &str = "2022";

/// Starter + Engine keywords this writer can serialise.
pub fn supported_keywords() -> &'static [&'static str] {
    &[
        "/BEGIN",
        "/GRNOD/NODE",
        "/FUNCT",
        "/IMPDISP",
        "/BCS",
        "/GRAV",
        "/AMS",
        "/RUN",
        "/ANIM/DT",
        "/TFILE",
        "/DT/NODA/CST",
        "/DT/AMS",
        "/END/ENGINE",
        "/END",
    ]
}

pub fn ensure_supported(solver: &str, version: &str) -> Result<(), Diagnostic> {
    if !solver.trim().eq_ignore_ascii_case("radioss") {
        return Err(
            Diagnostic::error("LC-COMPAT-001", format!("Radioss 后端不接受求解器“{solver}”"))
                .hint("Radioss 工况必须使用 solver = radioss；不要与 OptiStruct Writer 混用"),
        );
    }
    let v = version.trim();
    if v == SUPPORTED_SOLVER_VERSION || v.starts_with("2022.") {
        Ok(())
    } else {
        Err(
            Diagnostic::error("LC-COMPAT-001", format!("目标 Radioss 版本“{version}”未验证"))
                .hint("首版仅生成并验证 Radioss 2022 单文件增量卡片"),
        )
    }
}
