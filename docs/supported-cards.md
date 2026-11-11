# 已支持卡片（OptiStruct 2022）

> 生成文本 → 导入 → 重导出 → 求解 的实机闭环尚未执行，Import/Solver 列为 `pending`。
> 表格仅记录实现与文本级（L2）验证状态。

| Card | 用途 | 版本 | 官方文档 | Import | Solver | Fixture/测试 |
|---|---|---|---|---|---|---|
| FORCE | 节点集中力 | 2022 | 见 SPEC §19 | pending | pending | tests/kernel.rs · nodal_static |
| MOMENT | 节点集中力矩 | 2022 | 见 SPEC §19 | pending | pending | tests/kernel.rs · nodal_static |
| GRAV | 重力加速度 | 2022 | 见 SPEC §19 | pending | pending | tests/kernel.rs · gravity |
| SPC | 单点强迫位移 | 2022 | 见 SPEC §19 | pending | pending | constraint |
| SPC1 | 齐次单点约束 | 2022 | 见 SPEC §19 | pending | pending | constraint |
| SPCADD | 约束组合 | 2022 | 见 SPEC §19 | pending | pending | constraint |
| EIGRL | 模态提取 | 2022 | 见 SPEC §19 | pending | pending | normal_modes / random_psd |
| FREQ1 | 频点定义 | 2022 | 见 SPEC §19 | pending | pending | frequency_response / random_psd |
| TABDMP1 | 模态阻尼表 | 2022 | 见 SPEC §19 | pending | pending | random_psd |
| RLOAD2 | 参考动载（ACCE/LOAD） | 2022 | 见 SPEC §19 | pending | pending | random_psd |
| DLOAD | 动载组合 | 2022 | 见 SPEC §19 | pending | pending | random_psd |
| SPCD | 参考加速度 | 2022 | 见 SPEC §19 | pending | pending | random_psd |
| DAREA | 参考力 | 2022 | 见 SPEC §19 | pending | pending | random_psd |
| TABRND1 | PSD 谱表 | 2022 | 见 SPEC §19 | pending | pending | random_psd |
| RANDPS | 随机谱关联 | 2022 | 见 SPEC §19 | pending | pending | random_psd |
| EIGRA | AMSES 模态提取 | 2022 | SPEC A5.1 | pending | pending | optistruct_advanced |
| FREQ2 | 对数频点分布 | 2022 | SPEC A6 | pending | pending | optistruct_advanced |
| FREQ | 显式频点列表 | 2022 | SPEC A6 | pending | pending | optistruct_advanced |
| TABLED1 | 频率实/虚部权重表 | 2022 | SPEC A4 | pending | pending | optistruct_advanced |
| RLOAD1 | 复数实/虚动载 | 2022 | SPEC A3 | pending | pending | optistruct_advanced |

## 未支持（显式拒绝，避免伪装）

* OptiStruct 2019 / HyperMesh 2019/2022 目标版本（当前 `ensure_supported` 拒绝非 2022）。
* Radioss 后端、瞬态、压力、预载关联、惯性释放：未实现，不提供按钮。
* 互谱 / 同时相关多轴 PSD：未实现（需 Hermitian 半正定互谱矩阵校验 LC-PSD-113）。**顺序三轴（sequential-tri）已实现**：生成 3 个独立 MFREQ + 3 个独立 RANDOM 子工况，但不是同时相关随机合成。
* FREQ3 / FREQ4（模态间自适应 / 共振峰密集采样）：未实现，界面不提供。
* EIGRL 的 MAXSET/SHFSCL 等高级字段：未暴露。

## 字段级注意

* `RLOAD2` 的 `TB` 使用 `Rload2Tb::Constant / Table`，避免把整数 1 误当比例系数。
* `RLOAD1` 的 `DELAY/DPHASE` 使用 `RealOrRef`（实数 vs 卡 ID 语义不同），`TC/TD` 使用 `TableOrConst`（常数 vs TABLED1 ID）。
* `RANDPS` 的 `J/K` 是频响子工况 ID（自谱 J=K，Y=0），不是节点号。
* `TABRND1` 的 XAXIS/YAXIS 随插值方式生成；越界默认由工具校验拒绝（不是 TABRND1 原生字段）。

## Radioss 2022（实验性，P0 未执行）

> 独立 Writer；Single File Input 布局。Import/Solver 列均为 NOT_RUN，未伪造实测。

| Card | 用途 | Import | Solver | 测试 |
|---|---|---|---|---|
| /BEGIN | 运行名 / 版本 / 单位 | NOT_RUN | NOT_RUN | tests/radioss.rs |
| /GRNOD/NODE | 已有节点分组 | NOT_RUN | NOT_RUN | tests/radioss.rs |
| /FUNCT | 位移时间曲线 | NOT_RUN | NOT_RUN | tests/radioss.rs |
| /IMPDISP | 受控位移 | NOT_RUN | NOT_RUN | tests/radioss.rs |
| /BCS | 六自由度约束 | NOT_RUN | NOT_RUN | tests/radioss.rs |
| /GRAV | 重力（可选） | NOT_RUN | NOT_RUN | — |
| /AMS | AMS 作用 part group | NOT_RUN | NOT_RUN | tests/radioss.rs |
| /RUN | 运行名 / Tstop | NOT_RUN | NOT_RUN | tests/radioss.rs |
| /ANIM/DT | 动画间隔 | NOT_RUN | NOT_RUN | tests/radioss.rs |
| /TFILE | 时程间隔 | NOT_RUN | NOT_RUN | tests/radioss.rs |
| /DT/NODA/CST | 节点质量缩放 | NOT_RUN | NOT_RUN | — |
| /DT/AMS | AMS 时间步 | NOT_RUN | NOT_RUN | tests/radioss.rs |

已实现（受控位移近似）：FOPS 落锤冲击增量复用 ROPS 引擎（/IMPDISP 竖直方向），并在诊断中给出落锤质量/落差换算的冲击速度与能量；沿用 /GRNOD/NODE、/FUNCT、/IMPDISP、/BCS 等卡片。

未实现：FOPS 落锤实体、初速度（/INIV）、/INTER/TYPE7、/RBODY、多阶段 Engine。
