//! Typed Radioss card IR, deterministic id allocator and generation result.
//!
//! Modules never emit Radiosstext: they build typed engine/starter cards and the
//! Radioss writer renders them. This mirrors the OptiStruct DeckFragment design,
//! but keeps the two solver profiles fully separate (SPEC 5.3).

use std::collections::BTreeMap;

use serde::Serialize;

use crate::core::diagnostics::Diagnostic;
use crate::core::radioss_spec::RadiossContactThermal;

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
    SkewFix {
        id: u64,
        title: String,
        origin: [f64; 3],
        y_axis: [f64; 3],
        z_axis: [f64; 3],
    },
    InterType7 {
        id: u64,
        title: String,
        slave_grnod_id: u64,
        master_surf_id: u64,
        istf: i32,
        ithe: i32,
        igap: i32,
        ibag: i32,
        idel: i32,
        icurv: i32,
        iadm: i32,
        curv_node_id1: Option<u64>,
        curv_node_id2: Option<u64>,
        fscale_gap: f64,
        gap_max: f64,
        fpenmax: f64,
        i_tied: i32,
        st_min: f64,
        st_max: f64,
        percent_mesh_size: f64,
        dtmin: f64,
        irem_gap: i32,
        irem_i2: i32,
        stfac: f64,
        fric: f64,
        gap_min: f64,
        t_start: f64,
        t_stop: f64,
        ibc: String,
        inacti: i32,
        vis_s: f64,
        vis_f: f64,
        bumult: f64,
        ifric: i32,
        ifiltr: i32,
        xfreq: f64,
        iform: i32,
        sens_id: u64,
        fct_id_f: u64,
        ascale_f: f64,
        fric_id: u64,
        c1: f64,
        c2: f64,
        c3: f64,
        c4: f64,
        c5: f64,
        c6: f64,
        thermal: Option<RadiossContactThermal>,
    },
    TimeHistoryNode {
        id: u64,
        title: String,
        variables: Vec<String>,
        nodes: Vec<(u64, u64, String)>,
    },
    TimeHistoryElement {
        /// "SPRING" | "BEAM"
        kind: String,
        id: u64,
        title: String,
        variables: Vec<String>,
        elements: Vec<(u64, String)>,
    },
    TimeHistoryObject {
        /// "RBODY" | "RWALL" | "INTER" | "SECTIO" | "PART"
        kind: String,
        id: u64,
        title: String,
        variables: Vec<String>,
        object_ids: Vec<u64>,
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
            StarterCard::SkewFix { .. } => "/SKEW/FIX",
            StarterCard::InterType7 { .. } => "/INTER/TYPE7",
            StarterCard::TimeHistoryNode { .. } => "/TH/NODE",
            StarterCard::TimeHistoryElement { kind, .. } => match kind.as_str() {
                "BEAM" => "/TH/BEAM",
                _ => "/TH/SPRING",
            },
            StarterCard::TimeHistoryObject { kind, .. } => match kind.as_str() {
                "RBODY" => "/TH/RBODY",
                "RWALL" => "/TH/RWALL",
                "INTER" => "/TH/INTER",
                "SECTIO" => "/TH/SECTIO",
                "PART" => "/TH/PART",
                _ => "/TH/RBODY",
            },
        }
    }
}

#[derive(Debug, Clone)]
pub enum EngineCard {
    Vers {
        version: u32,
    },
    Run {
        name: String,
        number: u32,
        t_stop: f64,
    },
    Parith {
        on: bool,
    },
    Print {
        n_print: i32,
        n_line: i32,
    },
    AnimationDt {
        t_start: f64,
        t_freq: f64,
    },
    AnimElem {
        option: String,
    },
    AnimNoda {
        option: String,
    },
    AnimVect {
        option: String,
    },
    TimeHistory {
        file_type: Option<u32>,
        interval: f64,
    },
    TimeHistoryVersion {
        version: u32,
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
            EngineCard::Vers { .. } => "/VERS",
            EngineCard::Run { .. } => "/RUN",
            EngineCard::Parith { .. } => "/PARITH",
            EngineCard::Print { .. } => "/PRINT",
            EngineCard::AnimationDt { .. } => "/ANIM/DT",
            EngineCard::AnimElem { .. } => "/ANIM/ELEM",
            EngineCard::AnimNoda { .. } => "/ANIM/NODA",
            EngineCard::AnimVect { .. } => "/ANIM/VECT",
            EngineCard::TimeHistory { .. } => "/TFILE",
            EngineCard::TimeHistoryVersion { .. } => "/TH/VERS",
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
    Inter,
    Skew,
    Th,
}

impl RadIdKind {
    pub fn key(self) -> &'static str {
        match self {
            RadIdKind::Grnod => "grnod",
            RadIdKind::Funct => "funct",
            RadIdKind::Impdisp => "impdisp",
            RadIdKind::Bcs => "bcs",
            RadIdKind::Grav => "grav",
            RadIdKind::Inter => "inter",
            RadIdKind::Skew => "skew",
            RadIdKind::Th => "th",
        }
    }
    pub fn offset(self) -> u64 {
        match self {
            RadIdKind::Grnod => 1,
            RadIdKind::Funct => 10_001,
            RadIdKind::Impdisp => 20_001,
            RadIdKind::Bcs => 30_001,
            RadIdKind::Grav => 40_001,
            RadIdKind::Inter => 50_001,
            RadIdKind::Skew => 60_001,
            RadIdKind::Th => 70_001,
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
            RadIdKind::Inter,
            RadIdKind::Skew,
            RadIdKind::Th,
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
