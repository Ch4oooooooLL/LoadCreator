# Fixtures

`optistruct_2022/`：每个模块一个目录，包含 `input.json`（请求负载）、`expected.fem`
（确定性 Writer 输出 Golden）与 `expected.manifest.json`。由 `tests/golden.rs` 逐字节校验。

`manual-verification/`：L3/L4 实机验收脚手架，当前状态 `pending`（无 HyperMesh / OptiStruct
授权环境，未伪造任何 `.out` / `.h3d`）。

`radioss_2022/`：Radioss 2022 单文件增量 Golden（input.json + expected.rad），由 tests/radioss.rs 逐字节校验。
`manual-verification/radioss_2022/`：P0 实机验收状态，当前 pending（未执行）。
