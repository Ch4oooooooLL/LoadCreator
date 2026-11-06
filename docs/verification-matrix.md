# 验证矩阵与状态

四层测试互不替代（SPEC §14.1）：

| 层 | 目标 | 自动化 | 状态 |
|---|---|---|---|
| L1 数据/数学单测 | PSD 积分、单位、ID 规则、解析 | 是（cargo test） | ✅ 通过 |
| L2 Writer/引用 | 卡片字段、续行、确定性、跨引用 | 是（cargo test） | ✅ 通过 |
| L3 HyperMesh 2023.0 导入 | 导入后 Load Step/Collector/Control 保留 | 人工 | ⏳ pending |
| L4 OptiStruct 2022 求解 | 求解完成、结果可信 | 人工/license | ⏳ pending |

## 模块状态

| 模块 | Generated (L1/L2) | ImportVerified (L3) | SolverVerified (L4) | 对外状态 |
|---|---|---|---|---|
| tabular-load | ✅ 旧回归 | 历史可用/待复验 | 历史可用/待复验 | stable（旧功能） |
| nodal-static | ✅ | pending | pending | beta |
| constraint | ✅ | pending | pending | beta |
| gravity | ✅ | pending | pending | beta |
| normal-modes | ✅ | pending | pending | beta |
| frequency-response | ✅ | pending | pending | experimental |
| random-psd | ✅ | pending | pending | beta |
| radioss-rops（Radioss 2022） | ✅ 文本生成 | NOT_RUN | NOT_RUN | experimental |

## PSD 数值基准（已自动验证）

* 常数 PSD 0.01 g²/Hz，10–110 Hz → Grms = 1 g（LINEAR 与 LOG-LOG 均通过，容差 1e-9）。
* 1/f 对数-对数谱 (1,1)→(10,0.1) → 积分 = ln(10)（解析对照通过）。

## 待人工验证清单

见 `src-tauri/fixtures/manual-verification/`（README、status.json，状态 pending）。

## Radioss P0（强制，尚未执行）

- P0-A/B/C 见 qa/radioss/p0/README.md 与 acceptance.json（status = NOT_RUN）。
- 三实验全部 PASS 且可重复两次后，才可将模块状态从 experimental 提升。
