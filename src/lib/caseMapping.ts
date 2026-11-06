export interface MappingRule {
  id: string;
  keywords: string;
  englishName: string;
}

export const DEFAULT_MAPPING_RULES: MappingRule[] = [
  { id: "rule-static", keywords: "静满载 | 静载工况", englishName: "Static_Full_Load" },
  { id: "rule-front-axle", keywords: "前轮上跳", englishName: "Front_Axle_Bump" },
  { id: "rule-middle-axle", keywords: "中轮上跳", englishName: "Middle_Axle_Bump" },
  { id: "rule-rear-axle", keywords: "后轮上跳", englishName: "Rear_Axle_Bump" },
  { id: "rule-front-left", keywords: "左前单轮上跳", englishName: "Front_Left_Wheel_Bump" },
  { id: "rule-front-right", keywords: "右前单轮上跳", englishName: "Front_Right_Wheel_Bump" },
  { id: "rule-middle-left", keywords: "左中轮上跳", englishName: "Middle_Left_Wheel_Bump" },
  { id: "rule-middle-right", keywords: "右中轮上跳", englishName: "Middle_Right_Wheel_Bump" },
  { id: "rule-rear-left", keywords: "左后轮上跳", englishName: "Rear_Left_Wheel_Bump" },
  { id: "rule-rear-right", keywords: "右后轮上跳", englishName: "Rear_Right_Wheel_Bump" },
  { id: "rule-diagonal-fl-rr", keywords: "左前轮上跳 + 右后轮上跳", englishName: "Front_Left_and_Rear_Right_Bump" },
  { id: "rule-diagonal-fr-rl", keywords: "右前轮上跳 + 左后轮上跳", englishName: "Front_Right_and_Rear_Left_Bump" },
  { id: "rule-left-turn", keywords: "转弯 + 左转", englishName: "Left_Turn" },
  { id: "rule-right-turn", keywords: "转弯 + 右转", englishName: "Right_Turn" },
  { id: "rule-braking", keywords: "制动", englishName: "Braking_{g}" },
  { id: "rule-acceleration", keywords: "加速", englishName: "Acceleration_{g}" },
];

export interface RuleMatch {
  rule: MappingRule;
  index: number;
  keywords: string[];
}

/** Split "a + b | c" into alternatives where each alternative is a keyword group. */
export function ruleKeywordGroups(rule: MappingRule): string[][] {
  return rule.keywords
    .split(/[|｜]/)
    .map((group) => group.split(/[+，,、&＆]/).map((value) => value.trim()).filter(Boolean))
    .filter((group) => group.length > 0);
}

/** Rules that match a case name, ordered by specificity (most keywords first). */
export function matchingRules(name: string, rules: MappingRule[]): RuleMatch[] {
  const compact = name.replace(/\s+/g, "").replace(/＆/g, "&");
  return rules
    .map((rule, index) => {
      const matchedGroups = ruleKeywordGroups(rule).filter((group) => group.every((keyword) => compact.includes(keyword)));
      const keywords = matchedGroups.sort((a, b) => b.length - a.length || b.join("").length - a.join("").length)[0] ?? [];
      return { rule, index, keywords };
    })
    .filter(({ rule, keywords }) => rule.englishName.trim() && keywords.length > 0)
    .sort((a, b) => b.keywords.length - a.keywords.length || b.keywords.join("").length - a.keywords.join("").length || a.index - b.index);
}

/** Expand the {g} placeholder with the load factor found in the case name. */
export function applyCaseTemplate(template: string, name: string): string {
  const factor = name.replace(/\s+/g, "").match(/(\d+(?:\.\d+)?)g/i)?.[1];
  return template
    .replaceAll("_{g}", factor ? `_${factor}g` : "")
    .replaceAll("{g}", factor ? `${factor}g` : "");
}

export function suggestCaseAlias(name: string, index: number, rules: MappingRule[]): string {
  const matched = matchingRules(name, rules)[0];
  if (matched) return applyCaseTemplate(matched.rule.englishName.trim(), name);
  const ascii = name
    .replace(/[^a-zA-Z0-9.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 52);
  return ascii || `loadcase_${index + 1}`;
}

/** Detect duplicate / overlapping rules and ambiguous case matches. */
export function mappingIssues(rules: MappingRule[], caseNames: string[]): string[] {
  const issues = new Set<string>();
  rules.forEach((rule, index) => {
    if (ruleKeywordGroups(rule).length === 0 || !rule.englishName.trim()) issues.add(`第 ${index + 1} 条规则不完整，不会参与匹配`);
  });
  for (let left = 0; left < rules.length; left += 1) {
    const leftGroups = ruleKeywordGroups(rules[left]);
    if (!leftGroups.length) continue;
    for (let right = left + 1; right < rules.length; right += 1) {
      const rightGroups = ruleKeywordGroups(rules[right]);
      if (!rightGroups.length) continue;
      const groupPairs = leftGroups.flatMap((leftKeys) => rightGroups.map((rightKeys) => ({ leftKeys, rightKeys })));
      const sameKeywords = groupPairs.some(({ leftKeys, rightKeys }) => leftKeys.length === rightKeys.length && leftKeys.every((key) => rightKeys.includes(key)));
      if (sameKeywords) issues.add(`第 ${left + 1}、${right + 1} 条关键词重复，请删除或修改其中一条`);
      if (rules[left].englishName.trim() && rules[left].englishName.trim() === rules[right].englishName.trim()) issues.add(`第 ${left + 1}、${right + 1} 条英文名称相同，可能导致模型名称自动加序号`);
    }
  }
  caseNames.forEach((name) => {
    const matches = matchingRules(name, rules);
    if (matches.length > 1) issues.add(`“${name}”同时命中 ${matches.length} 条规则，将使用“${matches[0].rule.englishName}”`);
  });
  return [...issues];
}

/** Warn when two different cases resolve to the same in-model alias. */
export function aliasConflicts(resolved: Record<string, string>): string[] {
  const byAlias = new Map<string, string[]>();
  Object.entries(resolved).forEach(([caseName, alias]) => {
    const key = alias.trim().toLowerCase();
    if (!key) return;
    byAlias.set(key, [...(byAlias.get(key) ?? []), caseName]);
  });
  return [...byAlias.values()]
    .filter((names) => names.length > 1)
    .map((names) => `工况 ${names.map((name) => `“${name}”`).join("、")} 的模型内名称相同，生成时会自动追加序号，建议区分`);
}
