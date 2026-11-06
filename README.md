# LoadCreator 2.0

Rust + Tauri 2 + React 实现的离线 CAE 工况创建工作台。目标是把“选择工况模板 + 输入少量工程参数 +
外部实体 ID”变成**可增量导入 HyperMesh 的求解工况 FEM**，同时完整保留原有 Excel/WPS 表格载荷流程。

> 求解器：OptiStruct 2022（首版）。主输出始终是**增量 FEM**（只含新增载荷/求解控制，不含 GRID/材料/属性/单元）。

## 功能

整个应用是一个**统一工具箱**：左侧导航列出全部工况模板（含“整车工况生成”模块），右侧工作区完成参数、预览与导出；新增模块只需注册即可扩展。

### 工况工作台（新）
- **节点力/力矩**：多节点 FORCE / MOMENT，外部 SPC 引用。
- **位移约束**：SPC / SPC1 / SPCADD，支持引用现有集合与组合。
- **重力**：GRAV，单位感知（N-mm-s ≈ 9806.65 mm/s²）。
- **模态**：EIGRL + 模态子工况。
- **频率响应**：FREQ1 / TABDMP1 / EIGRL / MFREQ 子工况。
- **PSD 随机振动**：单输入/自谱/单轴；TABRND1 → RANDPS(J=K,Y=0) → MFREQ + RANDOM 子工况；
  Grms 解析积分校验；PSD+RMS / RMS-only 输出。

### Radioss（实验性 · UNVERIFIED_HM_IMPORT）
- **ROPS 受控位移**：生成单个不含网格的 Radioss 2022 单文件 `.rad` 增量（`/GRNOD/NODE`、`/FUNCT`、`/IMPDISP`、`/BCS`、`/RUN`、`/ANIM/DT`、`/TFILE`，可选 `/GRAV`、`/DT/NODA/CST`、`/AMS`+`/DT/AMS`）。工作台内置位移曲线、加载方向与求解时间轴的实时可视化预览。
- **FOPS 落锤冲击**：受控位移近似的落锤冲击增量（复用 ROPS 的 `/IMPDISP` 引擎，默认竖直 Z），并提供落锤质量 / 落差 / 重力 → 冲击速度 v₀ 与冲击能量的换算与校核。不生成落锤实体、`/INTER/TYPE7` 或 `/RBODY`，仍需 P0 实机验证。
- 已有节点/组仅作引用，绝不生成 `/NODE`；HyperMesh 2023.0 追加导入（P0-A/B/C）与 Radioss 2022 求解**尚未执行**，故标为 experimental。

### 整车工况生成（完整保留）
- Excel/WPS 粘贴、中英文列名与合并坐标表头识别。
- 中文点位名归并、英文名映射与 `{g}` 模板、同坐标不同名提示、JSON 键防覆盖。
- FEM 只引用节点号（不含 GRID），点位 JSON 按首次出现顺序。

## 架构

见 [docs/architecture.md](docs/architecture.md)。核心：`CaseSpec` → `DeckFragment` → `IdAllocator` →
OptiStruct 2022 Writer；Rust 为唯一卡片生成权威端，前端只负责字段与可视化。

## 验证状态（重要）

- L1/L2 自动化测试：`cargo test` 全部通过（WS Writer Golden、ID 规划、PSD 积分、原版回归）。
- L3 HyperMesh 2023.0 导入、L4 OptiStruct 2022 求解：**pending**（离线环境未执行，未伪造产物）。
- Radioss：仅完成文本生成（L1/L2）；P0 实机导入与 Radioss 2022 求解 **NOT_RUN**，模块标 experimental。
- 因此新模块对外标记为 **beta / experimental**，不宣称已实机验证。详见
  [docs/verification-matrix.md](docs/verification-matrix.md) 与 [docs/supported-cards.md](docs/supported-cards.md)。

## 开发与构建

```bash
npm install
npm run tauri:dev      # 开发运行（Rust 生成由桌面端执行）
npm run build          # 前端类型检查 + 构建
cd src-tauri && cargo test   # Rust L1/L2 测试
npm run tauri:build    # Windows NSIS 安装包（currentUser，无需管理员）
```

### 一键打包（安装包名带时间戳）

```bat
:: 双击或在仓库根目录执行；产物输出到 output\installers\
package-exe.bat
```

脚本 `package-exe.ps1`（`package-exe.bat` 为双击启动器，规避 PowerShell 执行策略）会：

1. 执行 `npm run tauri build`（前端构建 + Rust 发布编译 + NSIS 打包）；
2. 把生成的 `*-setup.exe` 复制为 `output\installers\LoadCreator_<版本>_<arch>_setup_<时间戳>.exe`；
3. 清理本次打包产生的临时文件（`dist\`、NSIS 工作目录、未加时间戳的原始安装包）。

可选参数：`-KeepIntermediates` 保留中间产物；`-SkipBuild` 跳过编译仅处理现有安装包；亦可 `npm run package:exe`。

## 文档

- [docs/radioss-rops.md](docs/radioss-rops.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/supported-cards.md](docs/supported-cards.md)
- [docs/increment-import.md](docs/increment-import.md)
- [docs/verification-matrix.md](docs/verification-matrix.md)
- [docs/user-guide.md](docs/user-guide.md)
- [docs/baseline-audit.md](docs/baseline-audit.md)
