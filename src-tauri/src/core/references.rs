//! Entity references and the external-reference ledger.
//!
//! A reference is either a generated entity (identified by a stable logical
//! key, whose concrete numeric id is assigned by the `IdAllocator`) or an
//! external id the user declares. External ids are *never* treated as verified:
//! they are always surfaced as `UNVERIFIED_EXTERNAL` because this tool does not
//! read the target model.

use serde::{Deserialize, Serialize};

use crate::core::ids::IdKind;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "kebab-case")]
pub enum EntityRef {
    Generated {
        kind: IdKind,
        key: String,
    },
    External {
        kind: IdKind,
        id: u64,
        label: Option<String>,
    },
}

impl EntityRef {
    pub fn generated(kind: IdKind, key: impl Into<String>) -> Self {
        Self::Generated {
            kind,
            key: key.into(),
        }
    }
    pub fn external(kind: IdKind, id: u64, label: Option<String>) -> Self {
        Self::External { kind, id, label }
    }
}

/// An external entity declared by the user. `status` is always
/// `UNVERIFIED_EXTERNAL` for now — the tool cannot prove it exists.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalReference {
    pub kind: IdKind,
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Always "UNVERIFIED_EXTERNAL" in this version.
    pub status: String,
    /// Which card/subcase consumes this reference.
    pub used_by: String,
}

impl ExternalReference {
    pub fn new(kind: IdKind, id: u64, label: Option<String>, used_by: impl Into<String>) -> Self {
        Self {
            kind,
            id,
            label,
            status: "UNVERIFIED_EXTERNAL".into(),
            used_by: used_by.into(),
        }
    }
}
