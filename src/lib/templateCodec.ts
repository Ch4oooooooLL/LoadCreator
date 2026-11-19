export interface TemplateDocument {
  schemaVersion: number;
  application: "LoadCreator";
  appVersion: string;
  exportedAt: string;
  modules: Record<string, Record<string, unknown>>;
}

export const TEMPLATE_SCHEMA_VERSION = 1;
export const TEMPLATE_APPLICATION = "LoadCreator";
export const TEMPLATE_APP_VERSION = "2.0.0";

const XML_TAG_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function isValidDirectKeyTag(key: string): boolean {
  if (!key || key === "item" || key === "entry") return false;
  if (/^xml/i.test(key)) return false;
  return XML_TAG_RE.test(key);
}

/** Strip characters disallowed by XML 1.0 (control chars except \t, \n, \r). */
function stripInvalidXmlChars(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
}

function escapeXmlText(text: string): string {
  return stripInvalidXmlChars(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#13;");
}

function escapeXmlAttr(text: string): string {
  return stripInvalidXmlChars(text)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\t/g, "&#9;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function encodeXmlValue(tag: string, value: unknown, indent: string, extraAttr = ""): string {
  const attrPrefix = extraAttr ? ` ${extraAttr}` : "";

  if (value === null || value === undefined) {
    return `${indent}<${tag}${attrPrefix} type="null" />`;
  }

  if (typeof value === "boolean") {
    return `${indent}<${tag}${attrPrefix} type="boolean">${value ? "true" : "false"}</${tag}>`;
  }

  if (typeof value === "number") {
    const safe = Number.isFinite(value) ? String(value) : "0";
    return `${indent}<${tag}${attrPrefix} type="number">${safe}</${tag}>`;
  }

  if (typeof value === "string") {
    return `${indent}<${tag}${attrPrefix} type="string">${escapeXmlText(value)}</${tag}>`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${indent}<${tag}${attrPrefix} type="array" />`;
    }
    const inner = value
      .map((item) => encodeXmlValue("item", item, `${indent}  `))
      .join("\n");
    return `${indent}<${tag}${attrPrefix} type="array">\n${inner}\n${indent}</${tag}>`;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) {
      return `${indent}<${tag}${attrPrefix} type="object" />`;
    }
    const inner = entries
      .map(([k, v]) =>
        isValidDirectKeyTag(k)
          ? encodeXmlValue(k, v, `${indent}  `)
          : encodeXmlValue("entry", v, `${indent}  `, `key="${escapeXmlAttr(k)}"`),
      )
      .join("\n");
    return `${indent}<${tag}${attrPrefix} type="object">\n${inner}\n${indent}</${tag}>`;
  }

  return `${indent}<${tag}${attrPrefix} type="string">${escapeXmlText(String(value))}</${tag}>`;
}

export function createTemplateDocument(
  modules: Record<string, Record<string, unknown>>,
  exportedAt = new Date().toISOString(),
): TemplateDocument {
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    application: TEMPLATE_APPLICATION,
    appVersion: TEMPLATE_APP_VERSION,
    exportedAt,
    modules,
  };
}

export function serializeTemplateToXml(doc: TemplateDocument): string {
  const moduleEntries = Object.entries(doc.modules);
  const modulesXml =
    moduleEntries.length === 0
      ? "  <modules />"
      : [
          "  <modules>",
          ...moduleEntries.map(([id, state]) => {
            const entries = Object.entries(state ?? {}).filter(([, v]) => v !== undefined);
            if (entries.length === 0) {
              return `    <module id="${escapeXmlAttr(id)}" />`;
            }
            const children = entries
              .map(([k, v]) =>
                isValidDirectKeyTag(k)
                  ? encodeXmlValue(k, v, "      ")
                  : encodeXmlValue("entry", v, "      ", `key="${escapeXmlAttr(k)}"`),
              )
              .join("\n");
            return `    <module id="${escapeXmlAttr(id)}">\n${children}\n    </module>`;
          }),
          "  </modules>",
        ].join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<LoadCreatorTemplate schemaVersion="${doc.schemaVersion}" application="${escapeXmlAttr(doc.application)}" appVersion="${escapeXmlAttr(doc.appVersion)}" exportedAt="${escapeXmlAttr(doc.exportedAt)}">`,
    modulesXml,
    "</LoadCreatorTemplate>",
    "",
  ].join("\n");
}

export function serializeTemplateToJson(doc: TemplateDocument): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

function directElementChildren(el: Element): Element[] {
  const list: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i += 1) {
    const child = el.childNodes[i];
    if (child.nodeType === 1) {
      list.push(child as Element);
    }
  }
  return list;
}

function decodeXmlElement(el: Element): unknown {
  const explicitType = el.getAttribute("type");
  const children = directElementChildren(el);

  switch (explicitType) {
    case "null":
      return null;
    case "boolean":
      return (el.textContent ?? "").trim().toLowerCase() === "true";
    case "number": {
      const parsed = Number((el.textContent ?? "").trim());
      return Number.isFinite(parsed) ? parsed : 0;
    }
    case "string":
      return el.textContent ?? "";
    case "array":
      return children.map((child) => decodeXmlElement(child));
    case "object":
      return decodeXmlObjectChildren(children);
    default: {
      if (children.length === 0) {
        return el.textContent ?? "";
      }
      if (children.every((child) => child.tagName === "item")) {
        return children.map((child) => decodeXmlElement(child));
      }
      return decodeXmlObjectChildren(children);
    }
  }
}

function decodeXmlObjectChildren(children: Element[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const child of children) {
    const keyAttr = child.tagName === "entry" ? child.getAttribute("key") : null;
    const key = keyAttr !== null ? keyAttr : child.tagName;
    out[key] = decodeXmlElement(child);
  }
  return out;
}

export function parseTemplateXml(xmlText: string, DomParserImpl?: typeof DOMParser): TemplateDocument {
  const ParserCtor = DomParserImpl ?? (typeof DOMParser !== "undefined" ? DOMParser : undefined);
  if (!ParserCtor) {
    throw new Error("当前运行环境不支持 XML 解析器");
  }
  const parser = new ParserCtor();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("XML 模板格式无效：" + (parserError.textContent?.trim() || "语法解析失败"));
  }
  const root = doc.documentElement;
  if (!root || root.tagName !== "LoadCreatorTemplate") {
    throw new Error("不是有效的 LoadCreator 模板文件（缺少 LoadCreatorTemplate 根节点）");
  }
  const schemaAttr = root.getAttribute("schemaVersion");
  const schemaVersion = schemaAttr ? parseInt(schemaAttr, 10) : TEMPLATE_SCHEMA_VERSION;
  if (!Number.isFinite(schemaVersion) || schemaVersion < 1) {
    throw new Error(`不支持的模板版本：${schemaAttr ?? "未知"}`);
  }

  const modulesEl = directElementChildren(root).find((el) => el.tagName === "modules");
  if (!modulesEl) {
    throw new Error("XML 模板缺少 <modules> 节点");
  }

  const modules: Record<string, Record<string, unknown>> = {};
  for (const modEl of directElementChildren(modulesEl)) {
    if (modEl.tagName !== "module") continue;
    const id = (modEl.getAttribute("id") ?? "").trim();
    if (!id) continue;
    modules[id] = decodeXmlObjectChildren(directElementChildren(modEl));
  }

  return {
    schemaVersion,
    application: "LoadCreator",
    appVersion: root.getAttribute("appVersion") || TEMPLATE_APP_VERSION,
    exportedAt: root.getAttribute("exportedAt") || "",
    modules,
  };
}

export function parseTemplateJson(jsonText: string): TemplateDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error("JSON 模板格式无效：" + (e instanceof Error ? e.message : String(e)));
  }
  if (!isPlainObject(parsed)) {
    throw new Error("JSON 模板根节点必须是对象");
  }
  const modulesRaw = parsed.modules;
  if (!isPlainObject(modulesRaw)) {
    throw new Error("JSON 模板缺少 modules 对象");
  }
  const modules: Record<string, Record<string, unknown>> = {};
  for (const [id, state] of Object.entries(modulesRaw)) {
    if (!id.trim() || !isPlainObject(state)) continue;
    modules[id] = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
  }
  const schemaRaw = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : TEMPLATE_SCHEMA_VERSION;
  return {
    schemaVersion: Number.isFinite(schemaRaw) && schemaRaw >= 1 ? schemaRaw : TEMPLATE_SCHEMA_VERSION,
    application: "LoadCreator",
    appVersion: typeof parsed.appVersion === "string" ? parsed.appVersion : TEMPLATE_APP_VERSION,
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : "",
    modules,
  };
}

export function parseTemplateText(rawText: string, DomParserImpl?: typeof DOMParser): TemplateDocument {
  const cleaned = rawText.replace(/^\uFEFF/, "").trim();
  if (!cleaned) {
    throw new Error("模板文件内容为空");
  }
  if (cleaned.startsWith("<")) {
    return parseTemplateXml(cleaned, DomParserImpl);
  }
  if (cleaned.startsWith("{")) {
    return parseTemplateJson(cleaned);
  }
  throw new Error("无法识别模板格式，请选择 LoadCreator 导出的 .xml 或 .json 模板文件");
}
