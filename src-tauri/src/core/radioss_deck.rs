//! Typed Radioss card IR, deterministic id allocator and generation result.
//!
//! Modules never emit Radiosstext: they build typed engine/starter cards and the
//! Radioss writer renders them. This mirrors the OptiStruct DeckFragment design,
//! but keeps the two solver profiles fully separate (SPEC 5.3).

use std::collections::BTreeMap;

use serde::Serialize;

use crate::core::diagnostics::Diagnostic;

#[derive(Debug, Clone)]
pub enum StarterCard {
    NodeGroup {
        id: u64,
        title: String,
        node_ids: Vec<u64>,
    },
    Function {
        id: u64,
        title: String,
        points: Vec<(f64, f64)>,
    },
    ImposedDisplacement {
        id: u64,
        title: String,
        function_id: u64,
        direction: String,
        skew_id: u64,
        sensor_id: u64,
        group_id: u64,
        icoor: u32,
        a_scale: f64,
        f_scale: f64,
        t_start: Option<f64>,
        t_stop: Option<f64>,
    },
    Boundary {
        id: u64,
        title: String,
        /// [TX, TY, TZ, RX, RY, RZ]
        dofs: [bool; 6],
        skew_id: u64,
        group_id: u64,
    },
    Gravity {
        id: u64,
        title: String,
        function_id: u64,
        direction: String,
        skew_id: u64,
        sensor_id: u64,
        group_id: u64,
        a_scale: f64,
        f_scale: f64,
    },
    Ams {
        part_group_id: u64,
    },
}

impl StarterCard {
    pub fn keyword(&self) -> &'static str {
        match self {
            StarterCard::NodeGroup { .. } => "/GRNOD/NODE",
            StarterCard::Function { .. } => "/FUNCT",
            StarterCard::ImposedDisplacement { .. } => "/IMPDISP",
            StarterCard::Boundary { .. } => "/BCS",
            StarterCard::Gravity { .. } => "/GRAV",
            StarterCard::Ams { .. } => "/AMS",
        }
    }
}

#[derive(Debug, Clone)]
pub enum EngineCard {
    Run {
        name: String,
        number: u32,
        t_stop: f64,
    },
    AnimationDt {
        t_start: f64,
        t_freq: f64,
    },
    TimeHistory {
        interval: f64,
    },
    NodalCst {
        scale: f64,
        min_step: f64,
    },
    AmsDt {
        scale: f64,
        min_step: f64,
    },
}

impl EngineCard {
    pub fn keyword(&self) -> &'static str {
        match self {
            EngineCard::Run { .. } => "/RUN",
            EngineCard::AnimationDt { .. } => "/ANIM/DT",
            EngineCard::TimeHistory { .. } => "/TFILE",
            EngineCard::NodalCst { .. } => "/DT/NODA/CST",
            EngineCard::AmsDt { .. } => "/DT/AMS",
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct RadiossDeck {
    pub engine: Vec<EngineCard>,
    pub starter: Vec<StarterCard>,
}

/// Generated id families. Each owns a distinct offset inside the generated range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RadIdKind {
    Grnod,
    Funct,
    Impdisp,
    Bcs,
    Grav,
}

impl RadIdKind {
    pub fn key(self) -> &'static str {
        match self {
            RadIdKind::Grnod => "grnod",
            RadIdKind::Funct => "funct",
            RadIdKind::Impdisp => "impdisp",
            RadIdKind::Bcs => "bcs",
            RadIdKind::Grav => "grav",
        }
    }
    pub fn offset(self) -> u64 {
        match self {
            RadIdKind::Grnod => 1,
            RadIdKind::Funct => 10_001,
            RadIdKind::Impdisp => 20_001,
            RadIdKind::Bcs => 30_001,
            RadIdKind::Grav => 40_001,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossIdAssignment {
    pub kind: String,
    pub key: String,
    pub id: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadiossExternalRef {
    pub kind: String,
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub status: String,
    pub used_by: String,
}

impl RadiossExternalRef {
    pub fn new(kind: &str, id: u64, label: Option<String>, used_by: &str) -> Self {
        Self {
            kind: kind.into(),
            id,
            label,
            status: "UNVERIFIED_EXTERNAL".into(),
            used_by: used_by.into(),
        }
    }
}

/// Deterministic allocator that never hands out an id inside a user-declared
/// occupied range (SPEC 3.4 / UT-18). Existing external ids are never redefined.
#[derive(Debug, Clone)]
pub struct RadiossIdAllocator {
    next: BTreeMap<RadIdKind, u64>,
    used: BTreeMap<(RadIdKind, String), u64>,
    occupied: Vec<(u64, u64)>,
    assignments: Vec<RadiossIdAssignment>,
}

impl RadiossIdAllocator {
    pub fn new(base: u64, ranges: &[[u64; 2]]) -> Self {
        let mut next = BTreeMap::new();
        for kind in [
            RadIdKind::Grnod,
            RadIdKind::Funct,
            RadIdKind::Impdisp,
            RadIdKind::Bcs,
            RadIdKind::Grav,
        ] {
            next.insert(kind, base.saturating_add(kind.offset()));
        }
        let occupied = ranges
            .iter()
            .map(|r| (r[0].min(r[1]), r[0].max(r[1])))
            .collect();
        Self {
            next,
            used: BTreeMap::new(),
            occupied,
            assignments: Vec::new(),
        }
    }

    fn blocked(&self, id: u64) -> bool {
        self.occupied.iter().any(|(lo, hi)| id >= *lo && id <= *hi)
    }

    pub fn allocate(&mut self, kind: RadIdKind, key: &str) -> u64 {
        if let Some(id) = self.used.get(&(kind, key.to_string())) {
            return *id;
        }
        let mut id = *self.next.get(&kind).unwrap_or(&1);
        while self.blocked(id) {
            id = id.saturating_add(1);
        }
        self.next.insert(kind, id.saturating_add(1));
        self.used.insert((kind, key.to_string()), id);
        self.assignments.push(RadiossIdAssignment {
            kind: kind.key().to_string(),
            key: key.to_string(),
            id,
        });
        id
    }

    pub fn assignments(&self) -> Vec<RadiossIdAssignment> {
        self.assignments.clone()
    }
}

/// A generated Radioss increment plus diagnostics / ledger for the command layer.
pub struct RadiossBuilt {
    pub deck: RadiossDeck,
    pub diagnostics: Vec<Diagnostic>,
    pub external: Vec<RadiossExternalRef>,
    pub id_plan: Vec<RadiossIdAssignment>,
    pub card_counts: BTreeMap<String, usize>,
}

impl RadiossBuilt {
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(Diagnostic::is_error)
    }
}
