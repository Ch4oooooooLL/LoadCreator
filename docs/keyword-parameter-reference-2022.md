# OptiStruct 2022 关键卡片字段参考（LoadCreator 生成器）

> 本文档对应 `LoadCreator_2022_Field_Reference_and_Agent_SPEC_v3.md` 的字段手册要求（SPEC §D1/§C3/§E4）。
> 每张卡片记录：可设置字段、允许值/默认、物理含义、实际影响与风险，以及本仓库的实现状态。
> **状态说明**：`Generated` = 已由 Rust Writer 生成并通过 L1/L2 文本级测试；`ImportVerified`/`SolverVerified` 需 HyperMesh 2023.0 / OptiStruct 2022 实机验证，当前均未执行。
> **本文件与 Writer 实现保持同步**：字段的序列化以 `src-tauri/src/solvers/optistruct/writer.rs` 与 `src-tauri/src/core/cards.rs` 为准，测试见 `src-tauri/tests/optistruct_advanced.rs` 与 `fixtures/optistruct_2022`。

## EIGRA —— AMSES 模态提取（新增，Generated）

字段格式：`EIGRA, SID, V1, V2, ND, MSGLVL, AMPFFACT, <空>, NORM`

| 字段 | 取值/默认 | 物理含义 | 实际影响与风险 |
|---|---|---|---|
| `SID` | 正整数 | 模态方法集合 ID，由子工况 `METHOD=SID` 引用 | 多个动态子工况可复用；不得与 EIGRL 的 SID 重复语义 |
| `V1` | 实数，默认 0；须 < V2 | 最低关注固有频率（Hz），不是模态阶数 | 自由模态含近 0 刚体模态，不可盲目删除 |
| `V2` | **必填**，> V1 | 最高模态频率上限（Hz） | 应高于随机分析最高频率并留裕量；缺失直接拒绝（LC-PSD-020） |
| `ND` | 正整数或空 | 期望提取的根数；空=全范围 | 同时给 V2 与 ND 时取范围内最多 ND 阶，可能欠提取 |
| `MSGLVL` | 0（默认）/1 | 是否打印 AMSES 奇异点信息 | 模型有机构/多余刚体自由度时开 1 排查 |
| `AMPFFACT` | 实数，官方默认 5.0；须 > 0 | 内部子结构模态扩展到 AMPFFACT×V2 | 提高精度但增加耗时；实体结构可考虑 5–15 |
| `NORM` | `MASS`(默认)/`MAX`/`ALL` | 特征向量归一化方式 | 影响结果标量幅值与模态展示，不等同物理峰值 |

## EIGRL —— Lanczos 模态提取（既有，Generated）

字段格式：`EIGRL, SID, ND, V1, V2`

| 字段 | 取值/默认 | 含义 | 影响与风险 |
|---|---|---|---|
| `SID` | 正整数 | 模态方法 ID | `METHOD=SID` |
| `ND` | 正整数或空 | 提取模态数 | 与频率区间二选一或并用 |
| `V1`/`V2` | 实数或空 | 频率下/上界（Hz） | 勿照搬 EIGRA 的“V2 必填”规则 |

> 模态法选择：`modal.solver` 含 `AMSES`/`EIGRA` → 生成 EIGRA，否则生成 EIGRL。切换时 AMSES 专属字段自动隐藏。

## RLOAD1 —— 复数实/虚频率输入（新增，Generated）

字段格式：`RLOAD1, SID, EXCITEID, DELAY, DPHASE, TC, TD, TYPE`；物理式 `P(f)=A[C(f)+iD(f)]exp(i(θ−2πfτ))`

| 字段 | 取值/默认 | 含义 | 影响与风险 |
|---|---|---|---|
| `SID` | 正整数，全局唯一 | 动态载荷定义 ID | 由 `DLOAD` 引用 |
| `EXCITEID` | 正整数 → SPCD（强制运动）或 DAREA/载荷集 | 频域幅值 A 的来源与施加位置 | `TYPE=ACCE` 时通常引用 SPCD |
| `DELAY` | 实数时间或非零整数 DELAY 卡 ID；默认 0 | 时间滞后 τ，产生 `−2πfτ` 相位 | **实数与整数卡 ID 语义不同**，界面必须区分（RealOrRef） |
| `DPHASE` | 实数相位角（度）或非零整数 DPHASE 卡 ID；默认 0 | 固定相位 θ | 多次点激励时才常用 |
| `TC` | 实数常量或 TABLED1 ID | 频率相关实部系数 C(f) | 单位实部输入用 `TC=1.0` |
| `TD` | 实数常量或 TABLED1 ID | 频率相关虚部系数 D(f) | `TC=TD=0` 非法 |
| `TYPE` | `LOAD`(默认)/`DISP`/`VELO`/`ACCE` | 载荷或强制位移/速度/加速度 | 对 SPCD 参考加速度必须选 ACCE，不得留默认 LOAD |

> LoadCreator 生成的 RLOAD1 取 `TC=1.0, TD=0.0`（单位实部输入），`DELAY/DPHASE` 留空，`TYPE` 与激励类型一致。

## RLOAD2 —— 幅值/相位表达（既有，Generated）

字段：`RLOAD2, SID, EXCITEID, DELAY, DPHASE, TB, TP, TYPE`。`TB` 为幅值（常数或表）、`TP` 为相位曲线。
**RLOAD1 用实/虚部，RLOAD2 用幅值/相位；不可把 RLOAD1.TD 的虚部表直接复制到 RLOAD2.TP。** 旧工程不得自动迁移改变形式。

## TABLED1 —— RLOAD1 实/虚部随频率变化（新增，Generated）

字段格式：`TABLED1, TID, XAXIS, YAXIS, [FLAT], (x_i,y_i)..., ENDT`

| 字段 | 取值/默认 | 含义 | 影响与风险 |
|---|---|---|---|
| `TID` | 正整数 | 表 ID | `RLOAD1.TC/TD` 引用；不可用 TABRND1 顶替 |
| `XAXIS` | `LINEAR`(默认)/`LOG` | 频率轴插值 | LOG 要求 x>0 |
| `YAXIS` | `LINEAR`(默认)/`LOG`/`SMOOTH` | 纵轴插值 | `SMOOTH` 仅 TABLED1 支持，勿加给 TABRND1 |
| `FLAT` | 0(默认线性外推)/1(端点保持) | 超范围行为 | 单位函数建议 FLAT=1 |
| `x_i/y_i` | 实数点对 | 频率点与复幅值系数 | 单位 TABLED1 可两点皆为 1 |

## TABRND1 —— 输入 PSD 谱（既有，Generated）

字段：`TABRND1, ID, XAXIS, YAXIS, (f_i,S_i)..., ENDT`

| 字段 | 取值/默认 | 含义 | 软件校验 |
|---|---|---|---|
| `ID` | 正整数 | PSD 谱表号，由 RANDPS.TID 引用 | 同家族 ID 冲突检查 |
| `XAXIS`/`YAXIS` | `LINEAR`(默认)/`LOG` | 频率/谱密度插值 | LOG 轴禁止 0/负值（LC-PSD-105/001） |
| `f_i` | 实数 >0，升序 | PSD 拐点频率 | 至少 2 点，严格递增 |
| `S_i` | 实数 ≥0（自谱） | 功率谱密度，单位（输入量）²/Hz | 负值拒绝；LOG 插值下 0 拒绝 |
| 越界策略 | 产品层 ERROR/FLAT | 求解频段超出谱表时的处理 | 默认 ERROR 拒绝外推，FLAT 取端点 |

## FREQi 家族 —— 频点分布（FREQ1/FREQ2/FREQ 已实现，FREQ3/FREQ4 规划中）

| 卡片 | 字段 | 含义 | 频点总数 |
|---|---|---|---|
| `FREQ1` | `SID, F1, DF, NDF` | 等间隔频点：起始 F1、步长 DF、增量个数 NDF | `NDF+1`，末频 `F1+DF×NDF` |
| `FREQ2`（新增） | `SID, F1, F2, NF` | 对数区间：F1 起、F2 止、NF 区间数 | `NF+1`，`f_i=F1·(F2/F1)^{(i-1)/NF}` |
| `FREQ`（新增） | `SID, F1,F2,...` | 直接列出每个频率值 | 去重排序后取并集 |
| `FREQ3`/`FREQ4` | — | 模态间自适应插值 / 共振峰附近密集采样 | 未实现，界面不提供按钮 |

**校验**：FREQ2 要求 F1>0、F2>F1、NF>0；FREQ 要求至少两点且严格递增；PSD 求积精度由频点密度与共振峰覆盖决定。

## TABDMP1 —— 模态阻尼表（既有，Generated）

字段：`TABDMP1, TID, TYPE, FLAT, (f_i,g_i)..., ENDT`

| 字段 | 取值/默认 | 含义 | 风险 |
|---|---|---|---|
| `TID` | 正整数 | 阻尼表号，`SDAMPING=TID` | 可分频段设不同阻尼 |
| `TYPE` | `G`(默认)/`CRIT`/`Q` | 损耗因子 / 临界阻尼比 ζ / 品质因数 Q | **ζ=0.02 ≠ G=0.02**；小阻尼 `G≈2ζ`、`Q≈1/(2ζ)` |
| `FLAT` | 0(线性外推)/1(端点保持) | 超出定义频段的行为 | 高阻尼点后线性外推可能非物理 |

> LoadCreator 以 `TYPE` 留空（默认 G）+ 用户输入的“临界阻尼比”作为比值写入，界面需明确显示实际写入的 TYPE 与换算，避免把 ζ 当 G 的误用。

## SPCD —— 动态强制运动基准幅值（既有，Generated）

字段：`SPCD, SID, GID, C, D`

| 字段 | 取值 | 含义 | 校验 |
|---|---|---|---|
| `SID` | 正整数 | 强迫运动集合 ID，供 RLOAD.EXCITEID 引用 | 与 RLOAD 的 SID 区分 |
| `GID` | 节点号 | 单节点激励 | 节点须已存在于模型（UNVERIFIED_EXTERNAL） |
| `C` | 1/2/3（平动），4/5/6（转动） | 施加自由度 | 必须与子工况 SPC 覆盖的自由度一致（LC-REF-001） |
| `D` | 实数 | 基准运动数值；物理量由 RLOAD.TYPE 决定 | `D=1.0` 为参考形状；D=2 会使 PSD 随幅值平方变化 |

## DLOAD —— 动载组合（既有，Generated）

`DLOAD, SID, S, S1, L1, S2, L2, ...`：SID 组合号；S 全局系数；每项 Si 系数 × Li（RLOAD/TLOAD ID）。合成幅值=全局系数×分项系数。**不能当 SPC 约束组合。**

## RANDPS —— 随机谱与频响子工况绑定（既有，Generated）

字段：`RANDPS, SID, J, K, X, Y, TID`；互谱 `S_JK(f)=(X+iY)G(f)`

| 字段 | 取值 | 含义 | 风险/校验 |
|---|---|---|---|
| `J`/`K` | 频响 SUBCASE ID，`K≥J` | 传递函数索引 | **不是节点/RLOAD/方向号**（LC-PSD-103） |
| `X` | 实数 | 谱表前复系数实部 | 自谱通常 X=1 |
| `Y` | 实数；自谱 J=K 必须 0 | 复系数虚部（交叉相位） | J=K 且 Y≠0 → ERROR（LC-PSD-104） |
| `TID` | TABRND1 ID 或 0(=G(f)=1) | 输入谱形状 | 0 为单位常数谱，非“无输入” |

**多轴语义**：顺序三轴（sequential-tri）为**三个相互独立**的自谱工况（3 MFREQ + 3 RANDOM），**不是**同时相关随机；真实同时相关需构建 Hermitian 半正定互谱矩阵（LC-PSD-113），当前未实现。

## 版本与验证状态（摘要）

| 卡片 | 生成（L1/L2） | HM 导入 | 求解 | 备注 |
|---|---|---|---|---|
| EIGRL / FREQ1 / TABDMP1 / RLOAD2 / SPCD / DLOAD / TABRND1 / RANDPS | ✅ | pending | pending | 既有，golden 覆盖 |
| EIGRA | ✅ | pending | pending | 新增，字段枚举按 SPEC A5.1 |
| RLOAD1 | ✅ | pending | pending | 新增，TC/TD 常量或 TABLED1 |
| TABLED1 | ✅ | pending | pending | 新增 |
| FREQ2 / FREQ | ✅ | pending | pending | 新增 |

> 未真实运行 HyperMesh 2023.0 与 OptiStruct 2022 前，任何卡片都不得标记 ImportVerified/SolverVerified。
