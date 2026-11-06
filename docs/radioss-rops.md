# Radioss ROPS 单文件增量工况（实验性）

> 目标环境：Windows · HyperMesh 2023.0（Radioss user profile）· Radioss 2022
> 当前状态：**UNVERIFIED_HM_IMPORT / 实验性**。文本生成（L1/L2）已完成；HyperMesh 追加导入（P0-A/B/C）与 Radioss 2022 求解**尚未执行**，不得视为正式可用。

## 1. 定位

按开发 SPEC v1.0（方案 A）实现：LoadCreator 生成**一个不含网格、只引用已有节点**的 .rad 增量文件，
用户在 HyperMesh 中通过 File > Import > Solver Deck 追加到当前模型。文件依赖导入前 HM 已存在的网格与节点。

- 主输出：<RunName>_0000.rad（Radioss Single File Input 布局）。
- 附带：<RunName>_0000.manifest.json（外部引用台账 / 生成 ID / 单位 / 验证状态）。
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
- /IMPDISP 的 Dir 在第 2 个 10 字符字段内右对齐；/BCS 的 Trarot 为 6 位布尔码，在一个 10 字符字段内右对齐。
- 格式依据官方 2022 关键字文档：/BEGIN、/GRNOD/NODE、/FUNCT、/IMPDISP、/BCS、/GRAV、/AMS、/RUN、/ANIM/DT、/TFILE、/DT/AMS、/END/ENGINE 与 Single File Input。
- **注意**：字段宽度与 /BEGIN 的 Invers/单位编码仍需以 HyperMesh 2023.0 手工导出的 golden fixture 复核；未经 P0 前不得宣称可直接求解。

## 3. 单位契约

- 显式声明输入单位与工作单位（质量/长度/时间）。v1 **要求二者一致**，否则拒绝导出（不同单位换算未经 Engine 实测）。
- 必须勾选“已确认目标 HyperMesh 模型单位一致”，否则阻止导出。
- 时间曲线、终止时间、动画/时程间隔均使用同一时间单位。

## 4. ID 契约

- 已有节点/节点组/Skew/Part group 一律为外部引用，标记 UNVERIFIED_EXTERNAL，不输出重定义卡片。
- 新实体 ID 由确定性注册器分配，各类偏移不同（不会把 nodeId 当 groupId）：
  - 默认起始 800000：GRNOD 800001+、FUNCT 810001+、IMPDISP 820001+、BCS 830001+、GRAV 840001+。
- 支持“已占用 ID 区间”（如 800100-800200），生成器会跳过这些区间；绝不改动 existing refs。
- 因工具不读取当前 HM 文件，UI 明确提示需自行核对 ID 冲突。

## 5. 已实现 / 未实现

已实现（L1/L2 文本生成）：
- ROPS 受控位移：单节点加载（生成单节点 /GRNOD/NODE）或已有 /GRNOD；/FUNCT 曲线（严格递增校验、末点早于终止时间的线性外推警告）；
- 多约束节点组 /BCS（六自由度选项、可选 Skew）；加载/约束同组同自由度冲突拦截；
- Engine：/RUN、/ANIM/DT、/TFILE；/DT/NODA/CST 或 /AMS + /DT/AMS 配对；
- 可选 /GRAV。

已实现（受控位移近似）：
- FOPS 落锤冲击：复用 ROPS 受控位移引擎（/IMPDISP 沿竖直 Z），并据落锤质量 / 落差 / 重力换算冲击速度 v₀ 与冲击能量，作为 Info 诊断输出；不改变 deck 卡片。

未实现（按 SPEC 明确不做 / 需后续）：
- FOPS 初速度 / 自动落锤实体、/INTER/TYPE7、/RBODY、多阶段 Engine/restart、通用 RAD 解析。
- P0-A/B/C 实机导入验证与 Radioss 2022 求解级验证。

## 6. P0 验收（必须，尚未执行）

见 qa/radioss/p0/README.md。在 P0 三实验全部 PASS 前，模块保持 experimental。
