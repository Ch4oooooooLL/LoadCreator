//! HyperMesh-specific `$HMNAME` comment metadata.
//!
//! `$HMNAME` is metadata only: it must never be assumed sufficient to rebuild
//! an entity on import. Real import behaviour is verified separately (L3).

use crate::core::deck_ir::EntityMetadata;

/// Render `$HMNAME` lines for generated entities. Names are ASCII-normalised so
/// the deck stays ASCII; Chinese labels live in the UI / companion JSON.
pub fn render(entries: &[EntityMetadata]) -> String {
    let mut out = String::new();
    for entry in entries {
        let name = ascii_name(&entry.name);
        if name.is_empty() {
            continue;
        }
        out.push_str(&format!(
            "$HMNAME {} {} \"{}\"\n",
            entry.category, entry.id, name
        ));
    }
    out
}

fn ascii_name(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}
