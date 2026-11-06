# Radioss 2022 导入/求解验收（pending）

1. 打开基线模型，选择 Radioss User Profile（2023.0）。
2. 记录已有 NODE / GRNOD / 约束 ID。
3. File > Import > Solver Deck 导入 src-tauri/fixtures/radioss_2022/rops_simple/expected.rad。
4. 检查 /GRNOD 成员、/IMPDISP 关联、/BCS、Engine 卡片位置。
5. 重导出合并单文件，运行 Radioss 2022 Starter/Engine，记录 .out。
6. 结果写入 status.json。当前：pending（未执行，未伪造）。
