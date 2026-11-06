//! Radioss solver backend. Kept separate from the OptiStruct writer (SPEC 5.1):
//! the two solvers never share card text or file layout.

pub mod capabilities_2022;
pub mod format;
pub mod writer;

pub use capabilities_2022::{ensure_supported, supported_keywords, SUPPORTED_SOLVER_VERSION};
pub use writer::{write_rad, RadiossWriteInput};
