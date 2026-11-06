# M0 基线审计

* 仓库：Ch4oooooooLL/LoadCreator，评估基线 main @ e91463b（与 SPEC 2026-11-06 基线一致）。
* 现有版本 0.1.8 → 升级为 2.0.0。

## 基线技术栈（实测）

* React 19.2 / Vite 7 / TypeScript 5.9；Tauri 2.11；Rust 2021（`x86_64-pc-windows-gnu`）。
* 现有命令：`parse_clipboard_table`、`build_load_deck`、`export_load_bundle`、`export_output_file`。
* 原 `load_deck.rs` 约 650 行：解析、归并、FEM/JSON 文本写出。

## 基线构建/测试（修复前后）

* `npm run build`：通过。
* `cargo test`：初始失败 —— lib 单元测试可执行文件缺少 Common-Controls v6 清单，
  进程在 `main` 前以 `STATUS_ENTRYPOINT_NOT_FOUND (0xC0000139)` 退出（`src-tauri/build.rs`
  已说明该 windows-gnu 现象，但 `rustc-link-arg-tests` 只覆盖集成测试，不含 lib 单元测试）。
* 处置：将 `load_deck` 的 11 个单元测试迁移到集成测试 `tests/legacy_regression.rs`
  （集成测试会获得 build.rs 注入的清单），lib 保持无单元测试 → `cargo test` 全绿且无链接告警。
  旧测试语义逐条保留，未删除任何用例。

## 原版输出基线

* 节点号自 1001，载荷 SID 自 100001，子工况自 1；输出 `SOL 101/CEND/SUBCASE/BEGIN BULK/FORCE/MOMENT/ENDDATA` + `$HMNAME`。
* 不输出 GRID；点位 JSON 按首次出现顺序，英文名重复追加节点号。
* 以上由 `tests/legacy_regression.rs`（11）与 `tests/load_deck.rs`（2）锁定。
