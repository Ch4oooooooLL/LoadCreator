//! Shared kernel for the LoadCreator 2.0 case workbench.
//!
//! Everything in this module is solver-semantics code with no Tauri dependency,
//! so it can be unit-tested and reasoned about independently of the desktop
//! shell. The Tauri command layer only deserialises requests and writes files.

pub mod cards;
pub mod case_spec;
pub mod deck_ir;
pub mod diagnostics;
pub mod ids;
pub mod psd;
pub mod radioss_deck;
pub mod radioss_spec;
pub mod references;
pub mod units;
pub mod validation;

pub use cards::{BulkCard, Vec3};
pub use deck_ir::{DeckFragment, EntityMetadata, GenerationContext, Subcase};
pub use diagnostics::{Diagnostic, Severity, ValidationReport};
pub use ids::{IdAllocator, IdKind, IdPolicy};
pub use references::{EntityRef, ExternalReference};
pub use units::UnitSystem;
