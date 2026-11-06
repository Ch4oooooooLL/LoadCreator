# HyperMesh 2023.0 导入验收（pending）

1. 打开目标模型，选择 OptiStruct User Profile。
2. 建立依赖的 Grid / SPC / 材料 / 单元，记录目标模型 ID。
3. File > Import > Solver Deck 导入 `fixtures/optistruct_2022/*/expected.fem`，记录日志。
4. 检查 Model Browser 新建的 Load Collector / Load Step / Control Card。
5. 重导出合并 FEM，结构化比对关键卡片与引用，禁止关键设置丢失。
6. 再导入第二个不同模块 FEM，验证不覆盖先前工况。

结果写入 status.json。当前：pending（未执行）。
