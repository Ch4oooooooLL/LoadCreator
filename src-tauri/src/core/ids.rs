//! Deterministic id planning and conflict detection.
//!
//! Three id families are kept distinct (SPEC §4.1):
//!   * Existing-model ids — supplied by the user, referenced only.
//!   * Generated ids — allocated here from a stable logical key.
//!   * Legacy point ids — emitted by the preserved tabular pipeline.
//!
//! Allocation is deterministic: the same policy, parameter set and logical keys
//! always produce the same numeric ids (no time / randomness). The allocator
//! also records external declarations so a generated id can be checked against
//! an explicitly reserved external range.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IdKind {
    Node,
    Element,
    Cid,
    Spc,
    SpcAdd,
    Load,
    Dload,
    Rload,
    Table,
    Random,
    Method,
    Freq,
    Damping,
    Subcase,
    Suport,
    Spcd,
    Darea,
}

impl IdKind {
    pub fn default_start(self) -> u64 {
        match self {
            IdKind::Node => 1_001,
            IdKind::Element => 1,
            IdKind::Cid => 1,
            IdKind::Spc => 900_001,
            IdKind::SpcAdd => 900_101,
            IdKind::Load => 300_001,
            IdKind::Dload => 300_101,
            IdKind::Rload => 310_001,
            IdKind::Table => 400_001,
            IdKind::Random => 400_101,
            IdKind::Method => 500_001,
            IdKind::Freq => 500_101,
            IdKind::Damping => 500_201,
            IdKind::Subcase => 101,
            IdKind::Suport => 600_001,
            IdKind::Spcd => 320_001,
            IdKind::Darea => 320_101,
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            IdKind::Node => "node",
            IdKind::Element => "element",
            IdKind::Cid => "cid",
            IdKind::Spc => "spc",
            IdKind::SpcAdd => "spcadd",
            IdKind::Load => "load",
            IdKind::Dload => "dload",
            IdKind::Rload => "rload",
            IdKind::Table => "table",
            IdKind::Random => "random",
            IdKind::Method => "method",
            IdKind::Freq => "freq",
            IdKind::Damping => "damping",
            IdKind::Subcase => "subcase",
            IdKind::Suport => "suport",
            IdKind::Spcd => "spcd",
            IdKind::Darea => "darea",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            IdKind::Node => "Node",
            IdKind::Element => "Element",
            IdKind::Cid => "CID",
            IdKind::Spc => "SPC",
            IdKind::SpcAdd => "SPCADD",
            IdKind::Load => "LOAD",
            IdKind::Dload => "DLOAD",
            IdKind::Rload => "RLOAD",
            IdKind::Table => "TABLE",
            IdKind::Random => "RANDPS",
            IdKind::Method => "METHOD/EIGRL",
            IdKind::Freq => "FREQ",
            IdKind::Damping => "TABDMP1",
            IdKind::Subcase => "SUBCASE",
            IdKind::Suport => "SUPORT",
            IdKind::Spcd => "SPCD",
            IdKind::Darea => "DAREA",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum IdPolicy {
    /// Preserve the original tabular pipeline defaults exactly.
    LegacyCompat,
    /// Central project-managed allocation (recommended for new projects).
    #[default]
    ProjectManaged,
    /// Explicit starting numbers per entity family.
    ManualRange {
        #[serde(default)]
        ranges: BTreeMap<String, u64>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdAssignment {
    pub kind: IdKind,
    pub key: String,
    pub id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdConflict {
    pub kind: IdKind,
    pub id: u64,
    pub external_label: Option<String>,
    pub generated_key: String,
}

#[derive(Debug, Clone)]
pub struct IdAllocator {
    policy: IdPolicy,
    next: BTreeMap<IdKind, u64>,
    assignments: BTreeMap<(IdKind, String), u64>,
    external: Vec<(IdKind, u64, Option<String>)>,
    used: BTreeMap<IdKind, BTreeMap<u64, String>>,
}

impl IdAllocator {
    pub fn new(policy: IdPolicy) -> Self {
        Self {
            policy,
            next: BTreeMap::new(),
            assignments: BTreeMap::new(),
            external: Vec::new(),
            used: BTreeMap::new(),
        }
    }

    pub fn policy(&self) -> &IdPolicy {
        &self.policy
    }

    fn start_for(&self, kind: IdKind) -> u64 {
        match &self.policy {
            IdPolicy::ManualRange { ranges } => ranges
                .get(kind.key())
                .copied()
                .unwrap_or_else(|| kind.default_start()),
            _ => kind.default_start(),
        }
    }

    fn is_external(&self, kind: IdKind, id: u64) -> Option<Option<String>> {
        self.external
            .iter()
            .find(|(k, i, _)| *k == kind && *i == id)
            .map(|(_, _, label)| label.clone())
    }

    /// Allocate (or look up) the stable numeric id for `key` within `kind`.
    pub fn allocate(&mut self, kind: IdKind, key: &str) -> u64 {
        let lookup = (kind, key.to_string());
        if let Some(id) = self.assignments.get(&lookup) {
            return *id;
        }
        let start = self.start_for(kind);
        let mut id = self.next.get(&kind).copied().unwrap_or(start);
        // Never hand out an id that the user explicitly reserved as external.
        while self.is_external(kind, id).is_some() {
            id += 1;
        }
        self.next.insert(kind, id + 1);
        self.assignments.insert(lookup, id);
        self.used
            .entry(kind)
            .or_default()
            .insert(id, key.to_string());
        id
    }

    /// Record an external entity id so collisions with generated ids are caught.
    pub fn note_external(&mut self, kind: IdKind, id: u64, label: Option<String>) {
        if !self.external.iter().any(|(k, i, _)| *k == kind && *i == id) {
            self.external.push((kind, id, label));
        }
    }

    pub fn assignments(&self) -> Vec<IdAssignment> {
        self.assignments
            .iter()
            .map(|((kind, key), id)| IdAssignment {
                kind: *kind,
                key: key.clone(),
                id: *id,
            })
            .collect()
    }

    /// Generated ids that collide with a declared external id of the same kind.
    pub fn conflicts(&self) -> Vec<IdConflict> {
        let mut out = Vec::new();
        for (kind, id, label) in &self.external {
            if let Some(key) = self.used.get(kind).and_then(|m| m.get(id)) {
                out.push(IdConflict {
                    kind: *kind,
                    id: *id,
                    external_label: label.clone(),
                    generated_key: key.clone(),
                });
            }
        }
        out
    }
}
