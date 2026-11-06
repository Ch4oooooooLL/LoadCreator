//! Deck intermediate representation plus the mutable generation context.
//!
//! Modules never emit FEM text. They allocate ids, push strongly-typed bulk
//! cards and describe subcases; the OptiStruct writer renders the document. This
//! keeps every new module on one shared card/reference model.

use crate::core::cards::{BulkCard, Vec3};
use crate::core::diagnostics::{Diagnostic, Severity};
use crate::core::ids::{IdAllocator, IdKind, IdPolicy};
use crate::core::references::ExternalReference;

#[derive(Debug, Clone)]
pub struct EntityMetadata {
    /// HyperMesh entity category, e.g. "LOADCOLS", "LOADSTEPS".
    pub category: String,
    pub id: u64,
    pub name: String,
}

#[derive(Debug, Clone, Default)]
pub struct Subcase {
    pub id: u64,
    pub label: String,
    pub analysis: Option<String>,
    pub spc: Option<u64>,
    pub load: Option<u64>,
    pub method: Option<u64>,
    pub freq: Option<u64>,
    pub sdamping: Option<u64>,
    pub dload: Option<u64>,
    pub random: Option<u64>,
    /// e.g. ("PRELOAD", subcase_id)
    pub statsub: Option<(String, u64)>,
    /// Raw case-control output lines such as `DISPLACEMENT(SORT1,PSDF)=ALL`.
    pub outputs: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct DeckFragment {
    /// Executive `SOL` number for this case (101 static, 103 modal, 111 mfreq ...).
    pub sol: Option<u32>,
    pub subcases: Vec<Subcase>,
    pub bulk_cards: Vec<BulkCard>,
    pub external_refs: Vec<ExternalReference>,
    pub metadata: Vec<EntityMetadata>,
    pub warnings: Vec<Diagnostic>,
}

impl DeckFragment {
    pub fn new(sol: u32) -> Self {
        Self {
            sol: Some(sol),
            ..Default::default()
        }
    }
}

/// Mutable state threaded through a single module's generation.
pub struct GenerationContext {
    pub solver: String,
    pub solver_version: String,
    pub model_units: String,
    pub allocator: IdAllocator,
    pub external_refs: Vec<ExternalReference>,
    pub metadata: Vec<EntityMetadata>,
    pub diagnostics: Vec<Diagnostic>,
}

impl GenerationContext {
    pub fn new(
        solver: impl Into<String>,
        solver_version: impl Into<String>,
        model_units: impl Into<String>,
        policy: IdPolicy,
    ) -> Self {
        Self {
            solver: solver.into(),
            solver_version: solver_version.into(),
            model_units: model_units.into(),
            allocator: IdAllocator::new(policy),
            external_refs: Vec::new(),
            metadata: Vec::new(),
            diagnostics: Vec::new(),
        }
    }

    pub fn allocate(&mut self, kind: IdKind, key: &str) -> u64 {
        self.allocator.allocate(kind, key)
    }

    /// Register a user-declared external entity and mark it unverified.
    pub fn note_external(&mut self, kind: IdKind, id: u64, label: Option<String>, used_by: &str) {
        self.allocator.note_external(kind, id, label.clone());
        self.external_refs
            .push(ExternalReference::new(kind, id, label, used_by));
    }

    pub fn metadata(&mut self, category: &str, id: u64, name: impl Into<String>) {
        self.metadata.push(EntityMetadata {
            category: category.into(),
            id,
            name: name.into(),
        });
    }

    pub fn error(&mut self, code: &str, message: impl Into<String>) {
        self.diagnostics.push(Diagnostic::error(code, message));
    }
    pub fn warn(&mut self, code: &str, message: impl Into<String>) {
        self.diagnostics.push(Diagnostic::warning(code, message));
    }
    pub fn info(&mut self, code: &str, message: impl Into<String>) {
        self.diagnostics.push(Diagnostic::info(code, message));
    }
    pub fn has_errors(&self) -> bool {
        self.diagnostics
            .iter()
            .any(|d| d.severity == Severity::Error)
    }

    /// Convert accumulated state into a deck fragment (consuming diagnostics
    /// produced so far into warnings, keeping errors visible to the caller).
    pub fn finish(self, fragment: &mut DeckFragment) {
        fragment.external_refs = self.external_refs;
        fragment.metadata = self.metadata;
        fragment.warnings = self
            .diagnostics
            .into_iter()
            .filter(|d| d.severity != Severity::Error)
            .collect();
    }

    /// Convenience: unit vector helper that also reports a diagnostic on error.
    pub fn require_direction(&mut self, v: Vec3, code: &str, field: &str) -> Option<Vec3> {
        match v.normalized() {
            Some(n) => Some(n),
            None => {
                self.diagnostics
                    .push(Diagnostic::error(code, "载荷方向向量为零或包含非有限值").field(field));
                None
            }
        }
    }
}
