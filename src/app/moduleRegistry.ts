import type { ModuleDescriptor } from "@/lib/caseApi";

/**
 * Front-end module catalogue. Titles/status mirror the Rust
 * `list_case_modules` output; the executable list is still authoritative on the
 * backend, this copy is only used for layout before the command resolves.
 *
 * Adding a module: append a descriptor here AND register it in the Rust
 * `modules::module_descriptors()`; the toolbox gallery/nav render automatically.
 */
export const FALLBACK_MODULES: ModuleDescriptor[] = [
  { id: "tabular-load", title: "整车工况生成", category: "vehicle", solver: "optistruct", minSupportedVersion: "2022", status: "stable", helpKey: "tabular-load", capabilityFlags: ["表格粘贴", "点位归并", "增量 FEM + JSON"] },
  { id: "nodal-static", title: "节点力 / 力矩", category: "static", solver: "optistruct", minSupportedVersion: "2022", status: "beta", helpKey: "nodal-static", capabilityFlags: ["FORCE", "MOMENT", "多节点"] },
  { id: "constraint", title: "位移约束", category: "static", solver: "optistruct", minSupportedVersion: "2022", status: "beta", helpKey: "constraint", capabilityFlags: ["SPC", "SPC1", "SPCADD"] },
  { id: "gravity", title: "重力", category: "static", solver: "optistruct", minSupportedVersion: "2022", status: "beta", helpKey: "gravity", capabilityFlags: ["GRAV", "多工况表", "单位换算"] },
  { id: "normal-modes", title: "模态", category: "modal", solver: "optistruct", minSupportedVersion: "2022", status: "beta", helpKey: "normal-modes", capabilityFlags: ["EIGRL", "模态子工况"] },
  { id: "frequency-response", title: "频率响应", category: "dynamic", solver: "optistruct", minSupportedVersion: "2022", status: "experimental", helpKey: "frequency-response", capabilityFlags: ["FREQ1", "TABDMP1", "MFREQ"] },
  { id: "random-psd", title: "PSD 随机振动", category: "dynamic", solver: "optistruct", minSupportedVersion: "2022", status: "beta", helpKey: "random-psd", capabilityFlags: ["EIGRL/EIGRA", "RLOAD1/RLOAD2", "FREQ1/FREQ2", "顺序三轴"] },
  { id: "radioss-rops", title: "ROPS 受控位移", category: "radioss", solver: "radioss", minSupportedVersion: "2022", status: "experimental", helpKey: "radioss-rops", capabilityFlags: ["/IMPDISP", "/SKEW/FIX", "/INTER/TYPE7", "单文件 .rad"] },
  { id: "radioss-fops", title: "FOPS 落锤冲击", category: "radioss", solver: "radioss", minSupportedVersion: "2022", status: "experimental", helpKey: "radioss-fops", capabilityFlags: ["落锤位移曲线", "/IMPDISP", "/INTER/TYPE7", "冲击能量换算"] },
];

export const MODULE_GROUPS: Array<{ id: string; label: string; hint: string }> = [
  { id: "vehicle", label: "整车工况", hint: "从整车载荷表批量生成工况" },
  { id: "static", label: "结构静力", hint: "节点载荷、位移约束与重力工况" },
  { id: "modal", label: "模态分析", hint: "固有频率与振型提取" },
  { id: "dynamic", label: "动力响应", hint: "频率响应与 PSD 随机振动" },
  { id: "radioss", label: "显式冲击 · Radioss", hint: "单文件 .rad 增量导入（实验性）" },
  { id: "special", label: "特殊", hint: "惯性释放 / 预载 / 瞬态（规划中）" },
];

export const MULTI_CASE_DESCRIPTOR: ModuleDescriptor = {
  id: "multi-case",
  title: "多工况联合建模",
  category: "multi",
  solver: "optistruct",
  minSupportedVersion: "2022",
  status: "beta",
  helpKey: "multi-case",
  capabilityFlags: ["跨工况引用", "统一单位制", "全局 ID 避让", "完整 .fem"],
};

export const CATEGORY_LABELS: Record<string, string> = {
  multi: "联合建模",
  vehicle: "整车工况",
  static: "结构静力",
  modal: "模态分析",
  dynamic: "动力响应",
  radioss: "显式冲击",
  special: "特殊",
};

export const STATUS_LABELS: Record<string, string> = {
  stable: "稳定",
  beta: "Beta",
  experimental: "实验性",
};

export interface ModuleMeta {
  shortName: string;
  solTag: string;
  outputExt: string;
  description: string;
}

export const MODULE_META: Record<string, ModuleMeta> = {
  "multi-case": {
    shortName: "多工况联合",
    solTag: "SOL 101/103/111",
    outputExt: ".fem + .manifest",
    description: "多工况协同编辑与跨工况约束/载荷联动，生成单一完整 OptiStruct .fem 模型。",
  },
  "tabular-load": {
    shortName: "整车工况",
    solTag: "SOL 101 · 批量",
    outputExt: ".fem + .json",
    description: "粘贴 Excel / WPS 载荷表，按中文点位名归并节点，批量生成增量 FEM 与点位 JSON。",
  },
  "nodal-static": {
    shortName: "节点力/矩",
    solTag: "SOL 101",
    outputExt: ".fem",
    description: "在指定节点施加集中力 / 力矩，支持合并或逐行子工况与局部坐标系 CID。",
  },
  constraint: {
    shortName: "位移约束",
    solTag: "SOL 101 · SPC",
    outputExt: ".fem",
    description: "新建 SPC / SPC1 位移约束、强迫位移，或通过 SPCADD 组合已有约束集合。",
  },
  gravity: {
    shortName: "重力载荷",
    solTag: "SOL 101 · GRAV",
    outputExt: ".fem",
    description: "表格化配置多组重力工况，逐行指定重力加速度与 X/Y/Z 方向系数（N1/N2/N3），批量生成 GRAV 与子工况。",
  },
  "normal-modes": {
    shortName: "模态提取",
    solTag: "SOL 103",
    outputExt: ".fem",
    description: "基于 EIGRL（Lanczos）的固有频率与振型提取子工况。",
  },
  "frequency-response": {
    shortName: "频率响应",
    solTag: "SOL 108 · MFREQ",
    outputExt: ".fem",
    description: "模态法频响分析：EIGRL + FREQ1 + TABDMP1 + MFREQ 扫频子工况。",
  },
  "random-psd": {
    shortName: "PSD 随机振动",
    solTag: "MFREQ + RANDOM",
    outputExt: ".fem",
    description: "TABRND1 → RANDPS → MFREQ + RANDOM 求解链，支持 EIGRA/EIGRL、RLOAD1/2、FREQ1/2/FREQ 与顺序三轴。",
  },
  "radioss-rops": {
    shortName: "ROPS 位移",
    solTag: "Radioss 2022",
    outputExt: "_0000.rad",
    description: "Radioss 2022 单文件增量：/IMPDISP 多方向加载（含 /SKEW/FIX）、/INTER/TYPE7 接触、/BCS 与 Engine 控制。",
  },
  "radioss-fops": {
    shortName: "FOPS 冲击",
    solTag: "Radioss 2022",
    outputExt: "_0000.rad",
    description: "Radioss 2022 落锤冲击增量：受控位移 + /INTER/TYPE7 工装接触，附落锤冲击能量/速度工程换算。",
  },
};

export function moduleMeta(id: string): ModuleMeta {
  return MODULE_META[id] ?? { shortName: id, solTag: "CAE", outputExt: ".fem", description: "工况生成模块。" };
}
