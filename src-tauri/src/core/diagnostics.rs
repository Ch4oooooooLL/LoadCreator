//! Structured diagnostics shared by every module and the writer.
//!
//! Codes follow the SPEC taxonomy: `LC-INPUT-001`, `LC-REF-001`,
//! `LC-ID-001`, `LC-UNIT-001`, `LC-PSD-001`, `LC-DECK-001`,
//! `LC-COMPAT-001`, `LC-IMPORT-001`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub severity: Severity,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

impl Diagnostic {
    pub fn new(severity: Severity, code: &str, message: impl Into<String>) -> Self {
        Self {
            severity,
            code: code.into(),
            message: message.into(),
            field_path: None,
            entity: None,
            hint: None,
        }
    }
    pub fn error(code: &str, message: impl Into<String>) -> Self {
        Self::new(Severity::Error, code, message)
    }
    pub fn warning(code: &str, message: impl Into<String>) -> Self {
        Self::new(Severity::Warning, code, message)
    }
    pub fn info(code: &str, message: impl Into<String>) -> Self {
        Self::new(Severity::Info, code, message)
    }
    pub fn field(mut self, path: impl Into<String>) -> Self {
        self.field_path = Some(path.into());
        self
    }
    pub fn entity(mut self, entity: impl Into<String>) -> Self {
        self.entity = Some(entity.into());
        self
    }
    pub fn hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }
    pub fn is_error(&self) -> bool {
        self.severity == Severity::Error
    }
}

/// A collection of diagnostics. A report with any `Error` blocks export.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub diagnostics: Vec<Diagnostic>,
}

impl ValidationReport {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn push(&mut self, diagnostic: Diagnostic) {
        self.diagnostics.push(diagnostic);
    }
    pub fn extend(&mut self, other: impl IntoIterator<Item = Diagnostic>) {
        self.diagnostics.extend(other);
    }
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(Diagnostic::is_error)
    }
    pub fn errors(&self) -> impl Iterator<Item = &Diagnostic> {
        self.diagnostics.iter().filter(|d| d.is_error())
    }
    pub fn warnings(&self) -> impl Iterator<Item = &Diagnostic> {
        self.diagnostics
            .iter()
            .filter(|d| d.severity == Severity::Warning)
    }
    pub fn is_empty(&self) -> bool {
        self.diagnostics.is_empty()
    }
}
