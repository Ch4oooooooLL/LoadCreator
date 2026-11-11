# LoadCreator 2.0 架构说明

## 分层

```
React UI (Workbench 工具箱 + 整车工况生成模块)
   ↓ 类型化 CaseRequest (Tauri invoke)
Tauri Commands (commands/case.rs · project.rs · export.rs)   ← 仅反序列化/分发/落盘
   ↓
Case Generator Modules (src/modules/*)                        ← 工程语义
   ↓
DeckFragment (core/deck_ir.rs) + BulkCard (core/cards.rs) + ExternalReference
   ↓
IdAllocator (core/ids.rs) → OptiStruct Writer (solvers/optistruct/writer.rs)
   ↓
增量 .fem + .manifest.json (+ 工程 .lccase.json)
```

* **Rust 是唯一求解卡片生成权威端**：前端只维护字段原值与可视化，从不拼接最终 FEM。
* **整车工况生成链路完全保留**：`src-tauri/src/load_deck.rs` 与 `parse_clipboard_table` /
  `build_load_deck` / `export_load_bundle` / `export_output_file` 命令未改动语义，旧
  `localStorage` 工程可通过 `migrate_legacy_workspace_cmd` 迁移为 schemaVersion 2。
* **新模块共享同一 Deck IR / ID 规划 / Writer**，禁止模块自行复制文本拼接器。
* **求解器能力门禁**：`solvers/optistruct/capabilities_2022.rs` 只放行 OptiStruct 2022，
  未知版本返回 `LC-COMPAT-001`，不静默回退。

## 核心类型

| 类型 | 位置 | 作用 |
|---|---|---|
| `CaseSpec` | core/case_spec.rs | 带 `kind` 判别式的类型化请求 |
| `DeckFragment` / `Subcase` | core/deck_ir.rs | 结构化 deck 片段（子工况、bulk 卡、外部引用、元数据） |
| `BulkCard` | core/cards.rs | 强类型卡片（FORCE/MOMENT/GRAV/SPC/SPC1/SPCADD/EIGRL/**EIGRA**/FREQ1/**FREQ2**/**FREQ**/TABDMP1/**TABLED1**/**RLOAD1**/RLOAD2/DLOAD/SPCD/DAREA/TABRND1/RANDPS） |
| `IdAllocator` | core/ids.rs | 确定性 ID 分配 + 外部引用冲突检测 |
| `GenerationContext` | core/deck_ir.rs | 生成期的分配器、单位、诊断、元数据 |
| `Diagnostic` | core/diagnostics.rs | ERROR / WARNING / INFO + 代码（LC-*） |
| `ExternalReference` | core/references.rs | 用户外部 ID，固定 `UNVERIFIED_EXTERNAL` |

## 关键不变量

1. 同一逻辑实体只分配一次 ID，重复调用返回同一编号。
2. 外部引用与自动生成 ID 同类型同值冲突时报 `LC-ID-001` 并阻止导出。
3. 任何无法序列化的数值（NaN/Inf）报 `LC-DECK-001`，不生成文本。
4. 输出确定性：同配置两次生成字节一致，不含时间戳/随机数。
5. 主输出始终是**增量 FEM**，不生成 GRID/材料/属性/单元。

## 验证层级

`Generated`（文本生成）≠ `ImportVerified`（HyperMesh 导入）≠ `SolverVerified`（OptiStruct 求解）。
本仓库离线环境仅证明 `Generated` 与 L1/L2 单元/Writer 测试；L3/L4 见 `docs/verification-matrix.md`，状态为 `pending`。

## Radioss 后端（独立求解器 Profile）

Radioss 不是 OptiStruct 的 SOL/SUBCASE 变体，使用**完全独立**的后端：

| 层 | 位置 | 说明 |
|---|---|---|
| Spec | core/radioss_spec.rs | RadiossRopsSpec：单位三元组、外部引用、曲线、Engine、ID 策略 |
| IR | core/radioss_deck.rs | StarterCard / EngineCard、RadiossDeck、确定性 ID 分配器 |
| Module | modules/radioss_rops.rs | ROPS 受控位移生成与校验（LC-UNIT/CURVE/REF/CONFLICT/COMPAT） |
| Writer | solvers/radioss/ | 10/20 字符固定字段格式化、Single File Input 组装、2022 能力门禁 |
| UI | src/Workbench.tsx · moduleRegistry.ts | 顶级 “Radioss 工况 → ROPS 受控位移” 入口 |

**关键不变量**：只生成增量卡片，不输出 /NODE /网格；外部 ID 一律 UNVERIFIED_EXTERNAL；
ID 家族隔离（node 不作 group）；P0 未通过前状态恒为 experimental。
