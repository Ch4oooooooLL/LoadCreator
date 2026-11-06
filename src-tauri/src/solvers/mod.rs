//! Solver-specific writers. OptiStruct is the first-class backend; a future
//! Radioss adapter must be a separate module, never mixed into the OptiStruct
//! writer (SPEC §10.4).

pub mod optistruct;
pub mod radioss;
