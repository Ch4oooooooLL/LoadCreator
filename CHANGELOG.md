# Changelog

## [Unreleased] — M2 OptiStruct 随机振动增强

### Added
- **EIGRA**（AMSES）模态提取卡片：SID/V1/V2/ND/MSGLVL/AMPFFACT/NORM；`modal.solver` 含 AMSES/EIGRA 时启用，V2 必填（LC-PSD-020）。
- **RLOAD1** 复数实/虚动载卡片：`DELAY/DPHASE` 用 `RealOrRef`（实数 vs 卡 ID），`TC/TD` 用 `TableOrConst`（常数 vs TABLED1 ID）；激励形式可选 `RLOAD1`/`RLOAD2`。
- **TABLED1** 频率实/虚部权重表（含 `FLAT`）。
- **FREQ2**（对数频点分布）与 **FREQ**（显式频点列表）；与既有 FREQ1 组成频点分布选择。
- **顺序三轴**（`axisMode=sequential-tri`）：生成 3 个独立 MFREQ + 3 个独立 RANDOM 子工况，各自独立自谱（非同时相关随机合成）。
- `docs/keyword-parameter-reference-2022.md`：EIGRA/EIGRL/RLOAD1/RLOAD2/TABLED1/TABRND1/FREQi/TABDMP1/SPCD/DLOAD/RANDPS 字段手册。
- 新增 `tests/optistruct_advanced.rs`（8 个 L1/L2 测试）覆盖上述卡片。

### Changed
- `RandomPsdSpec` 增加可选 `axisMode`、`excitationForm`、`eigra`，以及 `FrequencyRange.kind/nf/explicitHz`。所有新字段带默认值，旧请求与既有 golden（`random_psd_accel_z`）字节不变。
- 默认行为保持：EIGRL + RLOAD2 + FREQ1 + 单轴。

### Verification
- `cargo test`（integration: kernel/golden/legacy/radioss/psd_import/optistruct_advanced）通过；golden 逐字节一致。
- HyperMesh 2023.0 导入（L3）与 OptiStruct 2022 求解（L4）仍未执行，状态 pending；模块保持 beta。
