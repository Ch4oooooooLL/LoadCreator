# LoadCreator

Rust + Tauri + React 实现的离线 FEM 载荷表格转换器。

应用图标以表格、有限元节点与载荷箭头为核心视觉，源图位于
`src-tauri/icons/loadcreator-icon-source.png`。

- 从 Excel / WPS 粘贴载荷表并维护、校对记录。
- 以中文点位名称作为归并索引并从节点号 1001 开始编号；不同中文名称即使坐标相同也分别生成节点。
- 点位与节点编号页面显示中文名称；JSON 和 FEM 节点名称使用英文名称。
- JSON 以英文点位名称为键，记录 `nodeId`、`label` 和 `x/y/z` 坐标；重名时追加节点号防止覆盖并提示用户修正。
- JSON 严格保持点位在原表中首次出现的顺序；存在提示的节点不会被移动到末尾。
- FEM 输出 Load Collector、Load Step、FORCE 与 MOMENT，只引用节点号，不生成 GRID。
- 可为每个中文工况编辑 ASCII 别名，模型内使用 `LC_序号_别名` 与 `LS_序号_别名`。
- 内置基础工况关键词映射；映射规则可在校对页面新增、编辑、删除和恢复默认，并检测重复或交叉命中。
- 英文名称模板支持 `{g}`，例如 `制动 → Braking_{g}` 会生成 `Braking_0.15g`。
- 使用 JSON 在模型中建立同号节点后，可增量导入 FEM。

开发运行：

```bash
npm install
npm run tauri:dev
```

构建安装包：

```bash
npm run tauri:build
```
