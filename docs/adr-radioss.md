# Radioss 模块决策日志（ADR）

对应 SPEC v1.0 §9.3。本文件记录本次新增 Radioss 后端的关键决策。

## ADR-001 · 单文件增量导入（方案 A）
- 决策：输出单个、不含网格、供 HyperMesh 追加导入的 <RunName>_0000.rad。
- 理由：SPEC 唯一选定工作流；不修改基础模型、不注入 Tcl、不做双文件。
- 代价：依赖导入前 HM 已有网格/节点；P0-A/B/C 必须实机验证。

## ADR-002 · ExistingRef 只生成组引用
- 决策：已有 NODE 仅出现在 /GRNOD/NODE 成员中，绝不输出 /NODE 重定义。
- 若 HM Reader 不能解析外部引用，由 P0 失败阻断，而不是插入同号节点伪装成功。

## ADR-003 · Engine 单文件与第一 Engine File
- 决策：v1 只有一个 /RUN/.../1 与一个 /END/ENGINE；Engine 卡片位于文件最前。
- 合并导出仅合并第一个 Engine File；不生成第二 Engine 阶段。

## ADR-004 · Reader 弱保证与 P0 发布阻断
- 决策：P0-A/B/C 未通过前，模块状态恒为 experimental（UNVERIFIED_HM_IMPORT）。
- 不在本仓库伪造 p0_*.rad / p0_starter.out；证据脚手架见 qa/radioss/p0。

## ADR-005 · 单位策略与质量缩放禁默认
- 决策：显式输入/工作单位三元组，v1 要求一致；必须确认目标模型单位。
- 质量缩放（/DT/NODA/CST）与 AMS 不默认开启，需工程师显式选择；AMS 必须 Starter /AMS 与 Engine /DT/AMS 配对。

## ADR-006 · 独立 Radioss Writer 与 ID 家族
- 决策：Radioss 不复用 OptiStruct Writer / DeckFragment / $HMNAME；新增 solvers/radioss 与 RadiossDeck。
- 生成 ID 家族隔离（GRNOD/FUNCT/IMPDISP/BCS/GRAV 各自偏移，默认 800000 起），支持占用区间跳过。
