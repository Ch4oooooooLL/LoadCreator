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
  { id: "radioss-rops", title: "ROPS 受控位移", category: "radioss", solver: "radioss", minSupportedVersion: "2022", status: "experimental", helpKey: "radioss-rops", capabilityFlags: ["/GRNOD/NODE", "/FUNCT", "/IMPDISP", "单文件 .rad"] },
  { id: "radioss-fops", title: "FOPS 落锤冲击", category: "radioss", solver: "radioss", minSupportedVersion: "2022", status: "experimental", helpKey: "radioss-fops", capabilityFlags: ["落锤位移曲线", "/IMPDISP", "冲击能量换算", "单文件 .rad"] },
  { id: "tabular-load", title: "整车工况生成", category: "vehicle", solver: "optistruct", minSupportedVersion: "2022", status: "stable", helpKey: "tabular-load", capabilityFlags: ["表格粘贴", "点位归并", "增量 FEM + JSON"] },
  { id: "nodal-static", title: "节点力 / 力矩", category: "static", solver: "optistruct", minSupportedVersion: "2022", status: "beta", helpKey: "nodal-static", capabilityFlags: ["FORCE", "MOMENT", "多节点"] },
  { id: "constraint", title: "位移约束", category: "static", solver: "optistruct", minSupportedVersion: "2022", status: "beta", helpKey: "constraint", capabilityFlags: ["SPC", "SPC1", "SPCADD"] },
  { id: "gravity", title: "重力", category: "static", solver: "optistruct", minSupportedVersion: "2022", status: "beta", helpKey: "gravity", capabilityFlags: ["GRAV", "单位换算"] },
  { id: "normal-modes", title: "模态", category: "modal", solver: "optistruct", minSupportedVersion: "2022", status: "beta", helpKey: "normal-modes", capabilityFlags: ["EIGRL", "模态子工况"] },
  { id: "frequency-response", title: "频率响应", category: "dynamic", solver: "optistruct", minSupportedVersion: "2022", status: "experimental", helpKey: "frequency-response", capabilityFlags: ["FREQ1", "TABDMP1", "MFREQ"] },
  { id: "random-psd", title: "PSD 随机振动", category: "dynamic", solver: "optistruct", minSupportedVersion: "2022", status: "beta", helpKey: "random-psd", capabilityFlags: ["EIGRL/EIGRA", "RLOAD1/RLOAD2", "FREQ1/FREQ2", "顺序三轴"] },
];

export const MODULE_GROUPS: Array<{ id: string; label: string; hint: string }> = [
  { id: "radioss", label: "Radioss 工况", hint: "单文件 .rad 增量导入（实验性）" },
  { id: "vehicle", label: "整车工况", hint: "从整车载荷表批量生成工况" },
  { id: "static", label: "静力", hint: "节点载荷与约束" },
  { id: "modal", label: "模态", hint: "固有频率与振型" },
  { id: "dynamic", label: "动力", hint: "频率响应与随机振动" },
  { id: "special", label: "特殊", hint: "惯性释放 / 预载 / 瞬态（规划中）" },
];

export const CATEGORY_LABELS: Record<string, string> = {
  radioss: "Radioss 工况",
  vehicle: "整车工况",
  static: "静力",
  modal: "模态",
  dynamic: "动力",
  special: "特殊",
};

export const STATUS_LABELS: Record<string, string> = {
  stable: "稳定",
  beta: "Beta",
  experimental: "实验性",
};

export interface ModuleMeta {
  icon: string;
  description: string;
}

/** Front-end presentation metadata (icon + one-line description). */
export const MODULE_META: Record<string, ModuleMeta> = {
  "radioss-rops": { icon: "⛭", description: "Radioss 2022 单文件 .rad 增量：引用已有节点生成 /GRNOD/NODE、/FUNCT、/IMPDISP、/BCS 与 Engine 控制（实验性，需 P0 实机验证）。" },
  "radioss-fops": { icon: "⤓", description: "FOPS 落锤冲击：受控位移近似落锤下压，附落锤质量 / 落差 / 冲击能量与速度换算（实验性，需 P0 实机验证）。" },
  "tabular-load": { icon: "▦", description: "从 Excel / WPS 粘贴整车工况载荷表，按中文点位名归并，自动生成增量 FEM 与点位 JSON。" },
  "nodal-static": { icon: "↦", description: "在指定节点施加集中力 / 力矩，生成 FORCE / MOMENT 静力子工况。" },
  constraint: { icon: "⊣", description: "创建或引用 SPC / SPC1 / SPCADD 位移约束集合。" },
  gravity: { icon: "▼", description: "按模型单位换算的重力加速度工况（GRAV）。" },
  "normal-modes": { icon: "∿", description: "EIGRL 模态提取与模态子工况。" },
  "frequency-response": { icon: "≈", description: "频响分析：FREQ1 / TABDMP1 / MFREQ 子工况。" },
  "random-psd": { icon: "⋮⋮", description: "PSD 随机振动：TABRND1 → RANDPS → MFREQ + RANDOM；支持 EIGRA/EIGRL、RLOAD1/RLOAD2、FREQ1/FREQ2 与顺序三轴（独立自谱），含 Grms 校验。" },
};

export function moduleMeta(id: string): ModuleMeta {
  return MODULE_META[id] ?? { icon: "◆", description: "工况生成模块。" };
}
