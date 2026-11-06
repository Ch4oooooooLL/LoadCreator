//! Strongly-typed OptiStruct/Nastran bulk-data cards.
//!
//! Each variant owns its own field semantics; the writer is the only place that
//! turns these into free-field text. `TABRND1` / `TABDMP1` / `DLOAD` handle
//! their own continuation, so no global string join is ever used.

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }
    pub fn magnitude(self) -> f64 {
        (self.x * self.x + self.y * self.y + self.z * self.z).sqrt()
    }
    /// Unit vector, or `None` for a zero vector.
    pub fn normalized(self) -> Option<Vec3> {
        let m = self.magnitude();
        if m > 0.0 && m.is_finite() {
            Some(Vec3::new(self.x / m, self.y / m, self.z / m))
        } else {
            None
        }
    }
}

/// A `TB` field for `RLOAD2`: either a numeric constant or a table id. Keeping
/// it as text prevents the classic "integer 1 mistaken for scale 1.0" bug
/// (SPEC T-026) — the literal text is emitted verbatim inside the field.
#[derive(Debug, Clone, PartialEq)]
pub enum Rload2Tb {
    Constant(f64),
    Table(u64),
}

#[derive(Debug, Clone)]
pub enum BulkCard {
    Force {
        sid: u64,
        gid: u64,
        cid: u64,
        scale: f64,
        f: Vec3,
    },
    Moment {
        sid: u64,
        gid: u64,
        cid: u64,
        scale: f64,
        m: Vec3,
    },
    Grav {
        sid: u64,
        cid: u64,
        scale: f64,
        n: Vec3,
    },
    Spc {
        sid: u64,
        gid: u64,
        c: String,
        d: f64,
    },
    Spc1 {
        sid: u64,
        ps: String,
        c: String,
        dofs: String,
        nodes: Vec<u64>,
    },
    SpcAdd {
        sid: u64,
        sets: Vec<u64>,
    },
    Eigrl {
        sid: u64,
        nd: Option<u64>,
        v1: Option<f64>,
        v2: Option<f64>,
    },
    Freq1 {
        sid: u64,
        f1: f64,
        df: f64,
        nd: u64,
    },
    Tabdmp1 {
        sid: u64,
        xaxis: String,
        yaxis: String,
        pairs: Vec<(f64, f64)>,
    },
    Rload2 {
        sid: u64,
        exciteid: u64,
        delay: Option<f64>,
        dphase: Option<f64>,
        tb: Option<Rload2Tb>,
        tp: Option<f64>,
        rtype: String,
    },
    Dload {
        sid: u64,
        scale: f64,
        components: Vec<(f64, u64)>,
    },
    Spcd {
        sid: u64,
        gid: u64,
        component: u32,
        d: f64,
    },
    Darea {
        sid: u64,
        gid: u64,
        component: u32,
        a: f64,
    },
    Tabrnd1 {
        sid: u64,
        xaxis: String,
        yaxis: String,
        points: Vec<(f64, f64)>,
    },
    Randps {
        sid: u64,
        j: u64,
        k: u64,
        x: f64,
        y: f64,
        tid: u64,
    },
}

impl BulkCard {
    pub fn card_name(&self) -> &'static str {
        match self {
            BulkCard::Force { .. } => "FORCE",
            BulkCard::Moment { .. } => "MOMENT",
            BulkCard::Grav { .. } => "GRAV",
            BulkCard::Spc { .. } => "SPC",
            BulkCard::Spc1 { .. } => "SPC1",
            BulkCard::SpcAdd { .. } => "SPCADD",
            BulkCard::Eigrl { .. } => "EIGRL",
            BulkCard::Freq1 { .. } => "FREQ1",
            BulkCard::Tabdmp1 { .. } => "TABDMP1",
            BulkCard::Rload2 { .. } => "RLOAD2",
            BulkCard::Dload { .. } => "DLOAD",
            BulkCard::Spcd { .. } => "SPCD",
            BulkCard::Darea { .. } => "DAREA",
            BulkCard::Tabrnd1 { .. } => "TABRND1",
            BulkCard::Randps { .. } => "RANDPS",
        }
    }
}
