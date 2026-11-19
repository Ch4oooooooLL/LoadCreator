# Radioss ROPS 单文件增量工况（实验性）

> 目标环境：Windows · HyperMesh 2023.0（Radioss user profile）· Radioss 2022
> 已用 HyperMesh 2023.0.0.43 对 ROPS 和 FOPS 测试模型追加导入，另用 HyperMesh 2026.1 验证了 ROPS。Radioss 2026.1 对合并后的两套测试模型完成 Starter 和 Engine。目标模型和 Radioss 2022 求解仍需实测。

## 1. 定位

按开发 SPEC v1.0（方案 A）实现：LoadCreator 生成**一个不含网格、只引用已有节点**的 .rad 增量文件，
用户在 HyperMesh 中通过 File > Import > Solver Deck 追加到当前模型。文件依赖导入前 HM 已存在的网格与节点。

- 主输出：<RunName>_0000.rad（Radioss Single File Input 布局）。
- 附带 `<RunName>_0000.manifest.json` 外部引用和 ID 台账，以及 `<RunName>_functions.csv` 曲线点表。
- 绝不生成 /NODE、单元、材料、属性；绝不改写原模型。

## 2. 文件契约（Single File Input）

```
# RADIOSS
# ... 注释（状态、无网格声明）
/RUN/<RunName>/1
<Tstop>
/ANIM/DT
<Tstart> <Tfreq>
/TFILE
<ΔThis>
[/DT/NODA/CST | /DT/AMS]
<...>
/END/ENGINE
# ---- Starter increment ----
/BEGIN
<RunName>
2022
<Input mass length time>
<Work mass length time>
/GRNOD/NODE/<id>
<title>
<node ids, 10 per line>
/FUNCT/<id>
<title>
<X> <Y>            (每行一对，时间严格递增)
/IMPDISP/<id>
<title>
<fct> <Dir> <skew> <sensor> <grnd> <blank> <icoor>
<Ascalex> <FscaleY> [Tstart] [Tstop]
/BCS/<id>
<title>
<Trarot> <Skew_ID> <grnd_ID>
[/GRAV/<id> ...]
[/AMS
<grpart_ID>]
/END
```

- Engine 必须在文件最前，以 /END/ENGINE 结束；Starter 必须 /BEGIN 起始、/END 结束。
- 单文件不支持多个 Engine 实例，v1 固定 run_number = 1。
- `/IMPDISP` 的 Dir 在第 2 个 10 字符字段内右对齐。`/BCS` 的 Trarot 在第 1 个 10 字符字段内按 `TTT RRR` 排列。
- `/INTER/TYPE7` 保留基础标志行的第 6 列、`I_TIED` 前的第 7–8 列，以及 `Inacti` 前的第 2–3 列。启用曲率、摩擦或热接触参数时按关键字规定生成对应续行。[Radioss 2022 TYPE7](https://2022.help.altair.com/2022.2/hwsolvers/rad/topics/solvers/rad/inter_type7_starter_r.htm)
- 格式依据官方 2022 关键字文档：/BEGIN、/GRNOD/NODE、/FUNCT、/IMPDISP、/BCS、/GRAV、/AMS、/RUN、/ANIM/DT、/TFILE、/DT/AMS、/END/ENGINE 与 Single File Input。
- **注意**：字段宽度与 /BEGIN 的 Invers/单位编码仍需以 HyperMesh 2023.0 手工导出的 golden fixture 复核；未经 P0 前不得宣称可直接求解。

## 3. 单位契约

- 显式声明输入单位与工作单位（质量/长度/时间）。v1 **要求二者一致**，否则拒绝导出（不同单位换算未经 Engine 实测）。
- 必须勾选“已确认目标 HyperMesh 模型单位一致”，否则阻止导出。
- 时间曲线、终止时间、动画/时程间隔均使用同一时间单位。

## 4. ID 契约

- 已有节点/节点组/表面集/Skew/Part group 一律为外部引用，标记 UNVERIFIED_EXTERNAL，不输出重定义卡片。
- 新实体 ID 由确定性注册器分配，各类偏移不同（不会把 nodeId 当 groupId）：
  - 默认起始 800000：GRNOD 800001+、FUNCT 810001+、IMPDISP 820001+、BCS 830001+、GRAV 840001+、INTER 850001+、SKEW 860001+。
- 支持“已占用 ID 区间”（如 800100-800200），生成器会跳过这些区间；绝不改动 existing refs。
- 因工具不读取当前 HM 文件，UI 明确提示需自行核对 ID 冲突。

## 5. 已实现 / 未实现

已实现（L1/L2 文本生成）：
- ROPS 受控位移：单节点加载（生成单节点 /GRNOD/NODE）或已有 /GRNOD；/FUNCT 曲线（严格递增校验、末点早于终止时间的线性外推警告）；
- 多方向加载控制：支持坐标轴正/负向（`±X/Y/Z`、转动 `±XX/YY/ZZ`，负向自动设置 `Fscale_Y = -1.0`）以及自定义三维方向向量（自动生成 `/SKEW/FIX` 局部坐标系并令局部 `X'` 对准加载矢量）；
- 工装-模型接触 `/INTER/TYPE7`（Radioss 2022 基线）：支持用户填写模型侧从节点组 Set ID（`grnd_IDs`）与工装侧主表面 Set ID（`surf_IDm`），并按 Radioss 2022 Card 1–6 选项卡配置全部参数；
- 多约束节点组 /BCS（六自由度选项、可选 Skew）；加载/约束同组同自由度冲突拦截；
- ROPS 和 FOPS 均可配置恒定重力、表格曲线驱动重力或引用模型已有 `/FUNCT` 的重力。FOPS 新建工况预置沿 `-Z` 逐渐施加的 `1 g` 曲线。可指定节点组、局部坐标系与触发传感器。曲线查表时间为 `t / Ascale_x`。[Radioss 2022 /GRAV](https://2022.help.altair.com/2022/hwsolvers/rad/topics/solvers/rad/grav_starter_r.htm)
- 时程输出按模型实体选择。固定螺栓可选 `/TH/SPRING` 或 `/TH/BEAM`，原生 `/RBE2` 通过 `/TH/NODE` 监控主节点运动和受约束自由度反力，已有 `/RBODY` 和 `/RWALL` 分别填写各自的实体 ID。需要统计整体连接载荷时，可引用模型已有截面生成 `/TH/SECTIO`。[节点时程](https://2022.help.altair.com/2022/hwsolvers/rad/topics/solvers/rad/th_node_starter_r.htm) · [刚体时程](https://2022.help.altair.com/2022/hwsolvers/rad/topics/solvers/rad/th_rbody_starter_r.htm) · [刚性墙时程](https://2022.help.altair.com/2022/hwsolvers/rad/topics/solvers/rad/th_rwall_starter_r.htm)
- Engine 基础页包含 `ENG_FILEDATA`、`/VERS`、`/PARITH`、`/PRINT`、`/TFILE`、`/TH/VERS` 和时间步控制。动画页区分单元、节点标量和节点矢量。界面沿用 `ENERGY`、`PRES` 名称，输出 `/ANIM/ELEM/ENER` 和 `/ANIM/ELEM/P`。[单元输出](https://2022.help.altair.com/2022/hwsolvers/rad/topics/solvers/rad/anim_shell_restype_engine_r.htm) · [节点标量](https://2022.help.altair.com/2022/hwsolvers/rad/topics/solvers/rad/anim_noda_engine_r.htm) · [节点矢量](https://2022.help.altair.com/2022/hwsolvers/rad/topics/solvers/rad/anim_vect_engine_r.htm)
- Functions 区可导出当前工况的汇总 CSV 和 Excel 工作簿。Excel 包含汇总页及每条函数的 X/Y 两列表；增量 `.rad` 旁的 CSV 由实际生成的 `/FUNCT` 卡片整理。

已实现（受控位移近似）：
- FOPS 落锤冲击：复用 ROPS 受控位移引擎与 `/INTER/TYPE7` 工装-模型接触定义，并据落锤质量 / 落差 / 重力换算冲击速度 v₀ 与冲击能量，作为 Info 诊断输出。

未实现（按 SPEC 明确不做 / 需后续）：
- FOPS 初速度（/INIV）与自动刚体/落锤实体生成、/RBODY、多阶段 Engine/restart、通用 RAD 解析。
- P0-A/B/C 实机导入验证与 Radioss 2022 求解级验证。

## 6. 导出与追加导入

1. 在 LoadCreator 中确认单位与主模型一致，检查外部节点、节点组、表面集及 ID 分配，然后校验并重新导出 `_0000.rad`。
2. 在 HyperMesh 的 Radioss Block Profile 下打开已有主模型，使用 Solver Deck 追加导入增量，启用读取 Engine 文件。
3. 导入后核对接触主从集、约束、载荷方向、时程对象和 Engine。测试导入中 HyperMesh 保留主模型的 `/BEGIN`，会提示忽略增量中的重复卡。主从集关联用 ID 台账和模型实体确认。
4. 对完整模型导出求解文件。实测 HyperMesh 2023.0 和 2026.1 使用 Radioss 2022 模板回导时未保留非零 `I_TIED`。启用该选项时核对最终 `.rad` 中该续行的第 81–90 字符及原始值。

原定 Radioss 2022 验收矩阵见 `qa/radioss/p0/README.md`。
