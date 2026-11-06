//! PSD validation and spectral integration.
//!
//! The integral is analytic for the two interpolation modes that have closed
//! forms (LINEAR-LINEAR trapezoid, LOG-LOG power law) and a converged numerical
//! fallback for mixed modes. The "constant PSD 0.01 g²/Hz over 10–110 Hz → 1 g"
//! reference case (SPEC T-022) and the 1/f log-log case (T-023) are pinned by
//! integration tests.

use crate::core::diagnostics::Diagnostic;

/// Validate a PSD table: at least 2 points, positive strictly-increasing
/// frequencies, finite non-negative PSD values, and (for LOG modes) positive
/// PSD values.
pub fn validate_spectrum(points: &[(f64, f64)], interpolation: &str) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    if points.len() < 2 {
        out.push(Diagnostic::error("LC-PSD-001", "PSD 至少需要两个频点"));
        return out;
    }
    let uses_log = interpolation.contains("LOG");
    for (i, (f, s)) in points.iter().enumerate() {
        if !f.is_finite() || *f <= 0.0 {
            out.push(
                Diagnostic::error(
                    "LC-PSD-001",
                    format!("第 {} 个频点频率必须为正的有限值（Hz）", i + 1),
                )
                .field(format!("spectrum.points[{i}].frequencyHz")),
            );
        }
        if !s.is_finite() || *s < 0.0 {
            out.push(
                Diagnostic::error(
                    "LC-PSD-001",
                    format!("第 {} 个频点 PSD 必须为非负有限值", i + 1),
                )
                .field(format!("spectrum.points[{i}].psd")),
            );
        } else if uses_log && *s == 0.0 {
            out.push(
                Diagnostic::error(
                    "LC-PSD-001",
                    format!(
                        "对数插值下第 {} 个频点 PSD 不能为 0（log(0) 无意义）",
                        i + 1
                    ),
                )
                .field(format!("spectrum.points[{i}].psd")),
            );
        }
        if i > 0 {
            let prev = points[i - 1].0;
            if f.is_finite() && prev.is_finite() && *f <= prev {
                out.push(
                    Diagnostic::error(
                        "LC-PSD-001",
                        format!(
                            "频率必须严格递增：第 {} 个频点 {f} 不大于前一个 {prev}",
                            i + 1
                        ),
                    )
                    .field(format!("spectrum.points[{i}].frequencyHz")),
                );
            }
        }
    }
    out
}

/// Check that the spectrum covers the requested solve frequency range.
pub fn check_coverage(
    points: &[(f64, f64)],
    range: (f64, f64),
    out_of_range: &str,
) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    if points.is_empty() {
        return out;
    }
    let smin = points.first().map(|p| p.0).unwrap_or(0.0);
    let smax = points.last().map(|p| p.0).unwrap_or(0.0);
    if out_of_range.eq_ignore_ascii_case("FLAT") {
        return out;
    }
    if range.0 < smin || range.1 > smax {
        out.push(
            Diagnostic::error("LC-PSD-001", format!(
                "求解频段 {:.3}–{:.3} Hz 超出输入谱范围 {:.3}–{:.3} Hz；默认拒绝外推（可显式选择平坦外推）",
                range.0, range.1, smin, smax
            ))
            .field("frequency")
            .hint("如需外推，请将 outOfRange 设为 FLAT 并确认物理意义"),
        );
    }
    out
}

/// Integrate a PSD table over its full frequency extent, returning the area.
pub fn integrate_psd(points: &[(f64, f64)], interpolation: &str) -> Result<f64, String> {
    if points.len() < 2 {
        return Err("PSD 至少需要两个频点".into());
    }
    let mut total = 0.0;
    for pair in points.windows(2) {
        let (f1, s1) = pair[0];
        let (f2, s2) = pair[1];
        if !(f1.is_finite() && f2.is_finite() && s1.is_finite() && s2.is_finite())
            || f1 <= 0.0
            || f2 <= f1
        {
            return Err("PSD 频点非法，无法积分".into());
        }
        total += integrate_segment(f1, s1, f2, s2, interpolation)?;
    }
    Ok(total)
}

fn integrate_segment(
    f1: f64,
    s1: f64,
    f2: f64,
    s2: f64,
    interpolation: &str,
) -> Result<f64, String> {
    match interpolation {
        "LINEAR-LINEAR" => Ok(0.5 * (s1 + s2) * (f2 - f1)),
        "LOG-LOG" => {
            if s1 <= 0.0 || s2 <= 0.0 {
                return Err("对数-对数积分要求 PSD 为正".into());
            }
            let r = f2 / f1;
            let p = (s2 / s1).ln() / r.ln();
            let exponent = p + 1.0;
            if exponent.abs() < 1e-9 {
                Ok(s1 * f1 * r.ln())
            } else {
                Ok(s1 * f1 * (r.powf(exponent) - 1.0) / exponent)
            }
        }
        other => {
            // Converged numerical integration for LOG-LINEAR / LINEAR-LOG.
            let steps = 4096usize;
            let mut area = 0.0;
            let mut prev_f = f1;
            let mut prev_s = interpolate(other, f1, s1, f2, s2, f1);
            for i in 1..=steps {
                let t = i as f64 / steps as f64;
                let f = f1 + (f2 - f1) * t;
                let s = interpolate(other, f1, s1, f2, s2, f);
                area += 0.5 * (prev_s + s) * (f - prev_f);
                prev_f = f;
                prev_s = s;
            }
            Ok(area)
        }
    }
}

fn interpolate(mode: &str, f1: f64, s1: f64, f2: f64, s2: f64, f: f64) -> f64 {
    let t = (f - f1) / (f2 - f1);
    match mode {
        // log-x, linear-y: linear in ln(f)
        "LOG-LINEAR" => {
            let tf = (f / f1).ln() / (f2 / f1).ln();
            s1 + (s2 - s1) * tf
        }
        // linear-x, log-y: log-interpolated against frequency
        "LINEAR-LOG" => {
            if s1 <= 0.0 || s2 <= 0.0 {
                s1 + (s2 - s1) * t
            } else {
                (s1.ln() + (s2.ln() - s1.ln()) * t).exp()
            }
        }
        _ => s1 + (s2 - s1) * t,
    }
}

/// Grms = sqrt(area) for an acceleration PSD.
pub fn grms(points: &[(f64, f64)], interpolation: &str) -> Result<f64, String> {
    integrate_psd(points, interpolation).map(|area| area.max(0.0).sqrt())
}
