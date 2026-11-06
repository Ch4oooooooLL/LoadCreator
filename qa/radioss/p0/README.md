# Radioss P0 导入性可行性验证（NOT_RUN）

> 本目录为 SPEC v1.0 第 2 节 P0 的**证据脚手架**。当前环境无 HyperMesh 2023.0 / Radioss 2022
> 授权，三个实验均 **NOT_RUN**，未生成任何 p0_*.rad / p0_starter.out，也未伪造 PASS。

## 环境（待填写实测）
- HyperMesh 版本：2023.0（非 2023.1/2023.2）
- Radioss 版本：2022
- User Profile / Template：
- 记录日期：

## 实验 P0-A：Starter 引用关联
1. 基线 p0_base.hm：含 ≥3 个可确认已有 NODE、约束与主节点。
2. 导入仅含 /GRNOD/NODE、/FUNCT、/IMPDISP、/BCS 的无网格单文件（本项目 rops_simple 输出）。
3. File > Import > Solver Deck，append/merge。
4. 记录 Import Options（renumber/offset/保留原 ID/unsupported/Engine）。
5. 检查：原节点数量/坐标/ID 不变；/GRNOD 成员为导入前同批节点；/IMPDISP 指向有效组与曲线。
结果：NOT_RUN

## 实验 P0-B：Single File Engine 追加
1. 使用含 # RADIOSS、Engine、/END/ENGINE、/BEGIN.../END 的单文件对基线追加导入。
2. 检查 /RUN、/DT、/ANIM、/TFILE 是否进入第一 Engine File、是否重复创建、是否改变既有 Engine。
结果：NOT_RUN

## 实验 P0-C：往返导出与求解
1. File > Export > Solver Deck，Merge Starter and Engine 单文件。
2. 对合并后完整模型运行 Radioss 2022 Starter，检查 ERROR/WARNING、载荷节点集、Engine 控制。
3. 与手工 HM 等效工况语义对比。
结果：NOT_RUN

## 通过标准
三实验全部 PASS 且可从全新打开的基线重复两次，方可解除 experimental。
