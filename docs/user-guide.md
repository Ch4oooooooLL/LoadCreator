# LoadCreator 2.0 使用指南

## 统一工具箱

整个应用是一个工具箱：左侧导航按“静力 / 模态 / 动力 / 特殊”分组列出全部工况模板，选中后在右侧工作区
完成参数填写、校验预览与导出。整车工况生成与新模块在同一壳体内切换，不再分成两个独立程序。

* **整车工况生成**：作为独立模块保留原有 Excel/WPS 粘贴 → 数据校对 → 点位与节点 → 生成导出 的完整能力（流程已优化为三个自由切换页签）。
* **节点力/力矩、约束、重力、模态、频率响应、PSD 随机振动**：结构化表单 + 实时 FEM 预览。

新增模块只需在前端 `moduleRegistry` 与后端 `module_descriptors()` 注册，即可自动出现在工具箱导航中。

## 新建一个工况

1. 左侧选择模板：节点力/力矩、位移约束、重力、模态、频率响应、PSD 随机振动。
2. 填写工程参数：
   - 模型单位（N-mm-s / N-m-s）——求解器不定义默认单位。
   - 外部实体 ID：Node、SPC Set、CID、Subcase 等（工具不读取目标模型，一律视为未验证）。
3. 点击“校验 / 预览 FEM”：查看诊断、外部引用清单、ID 台账与 FEM 文本。
4. 红色 ERROR 阻止导出；黄色 WARNING 提示风险（如无约束）。
5. 点击“导出增量 FEM”，选择目录，写出 `.fem` 与 `.manifest.json`。

## PSD 随机振动（V1 单输入/自谱/单轴）

* 激励：基座加速度（SPCD + RLOAD2 TYPE=ACCE）或随机节点力（DAREA + RLOAD2 TYPE=LOAD）。
* 谱表：粘贴/编辑 Hz 与 PSD；支持 LOG-LOG / LINEAR-LINEAR 等插值。
* 校验：频率严格递增、PSD 非负有限、对数插值下 PSD 不为 0、默认拒绝频段外推。
* **必须勾选**“确认被激励 Node 的自由度包含在 SPC 集合中”，否则阻止导出。
* 输出档位：`PSD_AND_RMS`（PSDF）或 `RMS_ONLY`（RMS）。
* 生成链：SPCD/DAREA + RLOAD2 + DLOAD → MFREQ 子工况（SPC/METHOD/FREQ/SDAMPING/DLOAD）
  ，TABRND1 → RANDPS(J=K,Y=0) → RANDOM 子工况。

## 注意事项

* 增量 FEM 需先确保外部节点/集合存在，再导入 HyperMesh 2023.0。
* 当前发布为 beta：导入/求解实机验证尚未完成（见 verification-matrix）。

## Radioss ROPS 受控位移（实验性）

1. 左侧选择 “Radioss 工况 → ROPS 受控位移”。
2. 填写 ASCII Run Name、加载节点（或已有 GRNOD）、输入/工作单位并勾选“已确认与目标模型单位一致”。
3. 编辑位移曲线（时间严格递增）、约束节点组与六自由度、Engine 终止时间/输出间隔/时间步策略。
4. 点击“校验 / 预览”（Radioss Deck 预览），修复 ERROR 后点击“导出增量 .rad”。
5. 在 HyperMesh 2023.0 追加导入 .rad；核对 /GRNOD 成员、约束、Engine 位置；重导出合并单文件再运行 Radioss 2022。
6. 该模块为 experimental：P0 实机验证未执行，不得视为正式可用。
