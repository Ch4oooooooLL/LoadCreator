# 增量 FEM 导入说明

## 定位

LoadCreator 导出的是**增量 FEM**：只包含新增载荷/求解控制和必要注释，**不包含** GRID、单元、
材料、属性、连接。已有模型的网格与其它工况由用户维护。

## 文件

```
<Project>.fem            # 首要交付：HyperMesh File > Import > Solver Deck
<Project>.manifest.json  # 可选：求解器版本、单位、外部引用、ID 台账、验证状态
<Project>.lccase.json    # 可选：工程配置（可重开重生成）
```

## 步骤

1. 在 HyperMesh 2023.0 打开目标模型，选择 OptiStruct User Profile。
2. 确认真实存在的节点号、SPC 集合号、坐标系号与工况号（外部 ID 由用户输入）。
3. `File > Import > Solver Deck` 导入 `<Project>.fem`。
4. 检查 Model Browser 新建的 Load Collector / Load Step / Control Cards。
5. 重导出合并后的完整 FEM 做结构比对（允许无语义重排/浮点差异）。
6. 提交 OptiStruct 2022 求解，检查 `.out` 的 fatal/error/warning 与 `.h3d` 结果。

## 重要限制

* HyperMesh 只保证“追加到当前模型”；不保证所有 Case Control / 全局 PARAM 无损合并。
* 外部引用一律标记 `UNVERIFIED_EXTERNAL`：本工具不读取目标模型，无法证明 Node/SPC 存在。
* “能生成文本”不等于“已通过导入/求解”。对应模块状态见 `docs/verification-matrix.md`。
* 当前发布状态为 **beta**：Rust/前端完成，L3/L4 实机验证仍为 `pending`。

## Radioss（实验性）

- 输出 <RunName>_0000.rad（Single File Input：Engine 在前 /END/ENGINE，Starter /BEGIN.../END），不含 /NODE 与网格。
- HyperMesh 2023.0 使用同一 Radioss user profile，File > Import > Solver Deck 追加；若出现 ID 映射异常、未知引用、Engine 重复应停止。
- 导入插件行为（P0-A/B/C）尚未验证；不得声称可自动覆盖已有 Engine 卡。详见 docs/radioss-rops.md。
