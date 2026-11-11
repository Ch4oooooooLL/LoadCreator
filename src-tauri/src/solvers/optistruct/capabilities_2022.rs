//! OptiStruct 2022 capability gate.
//!
//! Only cards that are explicitly implemented and (at least at the L2 text
//! level) validated are allowed. Unknown solver versions are rejected rather
//! than silently downgraded (SPEC LC-COMPAT-001).

use crate::core::diagnostics::Diagnostic;

pub const SUPPORTED_SOLVER_VERSION: &str = "2022";

/// Cards this writer can serialise. Keep in sync with `BulkCard`.
pub fn supported_cards() -> &'static [&'static str] {
    &[
        "FORCE", "MOMENT", "GRAV", "SPC", "SPC1", "SPCADD", "EIGRL", "EIGRA", "FREQ1", "FREQ2",
        "FREQ", "TABDMP1", "TABLED1", "RLOAD1", "RLOAD2", "DLOAD", "SPCD", "DAREA", "TABRND1",
        "RANDPS",
    ]
}

pub fn ensure_supported(solver: &str, version: &str) -> Result<(), Diagnostic> {
    if !solver.trim().eq_ignore_ascii_case("optistruct") {
        return Err(
            Diagnostic::error("LC-COMPAT-001", format!("暂不支持求解器“{solver}”"))
                .hint("首版仅支持 OptiStruct 2022；Radioss 等为独立后端，未实现前不得生成"),
        );
    }
    let v = version.trim();
    if v == SUPPORTED_SOLVER_VERSION || v.starts_with("2022.") {
        Ok(())
    } else {
        Err(
            Diagnostic::error("LC-COMPAT-001", format!("目标求解器版本“{version}”未验证"))
                .hint("首版仅生成并验证 OptiStruct 2022 卡片"),
        )
    }
}
