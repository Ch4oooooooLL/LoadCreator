export type Draft = Record<string, any>;

export const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};

export const optInt = (value: unknown): number | undefined => {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const n = parseInt(text, 10);
  return Number.isFinite(n) ? n : undefined;
};

export const optNum = (value: unknown): number | undefined => {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const n = parseFloat(text);
  return Number.isFinite(n) ? n : undefined;
};

export const parseDofs = (value: unknown): number[] => {
  const text = String(value ?? "").replace(/\s+/g, "");
  const out = new Set<number>();
  text.split(",").filter(Boolean).forEach((token) => {
    const range = token.match(/^(\d+)-(\d+)$/);
    if (range) {
      const a = parseInt(range[1], 10);
      const b = parseInt(range[2], 10);
      for (let d = Math.min(a, b); d <= Math.max(a, b); d += 1) {
        if (d >= 1 && d <= 6) out.add(d);
      }
    } else if (/^[1-6]{2,}$/.test(token)) {
      for (const ch of token) out.add(parseInt(ch, 10));
    } else if (/^\d+$/.test(token)) {
      const d = parseInt(token, 10);
      if (d >= 1 && d <= 6) out.add(d);
    }
  });
  return [...out].sort((a, b) => a - b);
};

export const toggleDofInString = (value: unknown, dof: number): string => {
  const current = new Set(parseDofs(value));
  if (current.has(dof)) current.delete(dof);
  else current.add(dof);
  return [...current].sort((a, b) => a - b).join("");
};

export const parseIdList = (value: unknown): number[] =>
  String(value ?? "")
    .split(/[,\s，、;]+/)
    .filter(Boolean)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n));

export const parseFloatList = (value: unknown): number[] =>
  String(value ?? "")
    .split(/[,\s，、;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => parseFloat(s))
    .filter((n) => Number.isFinite(n));

export const parseRanges = (value: unknown): Array<[number, number]> =>
  String(value ?? "")
    .split(/[;\n]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const m = chunk.match(/^(\d+)\s*[-~]\s*(\d+)$/);
      if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)] as [number, number];
      const single = parseInt(chunk, 10);
      return Number.isFinite(single) ? ([single, single] as [number, number]) : null;
    })
    .filter((v): v is [number, number] => v !== null);

export function createDefaultRadiossContact(): Draft {
  return {
    title: "TOOL_MODEL_CONTACT",
    slaveGrnodId: "",
    masterSurfId: "",
    // Card 1 (Radioss 2022)
    istf: "4",
    ithe: "0",
    igap: "2",
    ibag: "0",
    idel: "2",
    icurv: "0",
    iadm: "0",
    curvNodeId1: "",
    curvNodeId2: "",
    // Card 2
    fscaleGap: "0.8",
    gapMax: "0",
    fpenmax: "0",
    iTied: "0",
    // Card 3
    stMin: "0",
    stMax: "0",
    percentMeshSize: "0.4",
    dtmin: "0",
    iremGap: "2",
    iremI2: "0",
    // Card 4
    stfac: "1.0",
    fric: "0.15",
    gapMin: "0.5",
    tStart: "0",
    tStop: "0",
    // Card 5
    ibc: "000",
    inacti: "6",
    visS: "0",
    visF: "0",
    bumult: "0",
    // Card 6
    ifric: "0",
    ifiltr: "0",
    xfreq: "0",
    iform: "2",
    sensId: "0",
    fctIdF: "0",
    ascaleF: "0",
    fricId: "0",
    // Card 7/8 (when Ifric > 0)
    c1: "0",
    c2: "0",
    c3: "0",
    c4: "0",
    c5: "0",
    c6: "0",
  };
}

export function createDefaultRadiossGravity(options?: {
  fops?: boolean;
  mode?: "constant" | "curve";
  title?: string;
  oneG?: number;
  endTime?: number;
}): Draft {
  const mode = options?.mode ?? (options?.fops ? "curve" : "constant");
  const oneG = options?.oneG ?? 0.00980665;
  const endT = options?.endTime ?? (options?.fops ? 0.05 : 0.1);
  const rampT = Number((endT * 0.2).toPrecision(4)) || 0.01;
  return {
    enabled: true,
    title: options?.title ?? (options?.fops ? "FOPS_GRAV_Z" : "ROPS_GRAV_Z"),
    mode,
    direction: "-Z",
    magnitude: String(oneG),
    aScale: "1.0",
    fScale: String(oneG),
    existingFunctId: "",
    skewId: "0",
    sensorId: "0",
    grnodId: "0",
    curve: [
      { time: "0", value: "0" },
      { time: String(rampT), value: "1" },
      { time: String(endT), value: "1" },
    ],
  };
}

export function createDefaultRadiossTh(preset: "bolt" | "bolt-beam" | "rwall-rbe2" | "rbody" | "rwall" | "rwall-node" | "contact" | "part" | "sectio"): Draft {
  switch (preset) {
    case "bolt":
      return {
        enabled: true,
        kind: "spring",
        role: "bolt",
        title: "TH_CAB_FIX_BOLTS",
        variables: ["FX", "FY", "FZ", "MX", "MY", "MZ", "IE", "OFF"],
        nodeEntries: [],
        elemEntries: [{ elemId: "", label: "CAB_BOLT_1" }],
        objectIdsText: "",
        contactIndices: [],
      };
    case "bolt-beam":
      return {
        enabled: true,
        kind: "beam",
        role: "bolt",
        title: "TH_CAB_BOLT_BEAMS",
        variables: ["DEF"],
        nodeEntries: [],
        elemEntries: [{ elemId: "", label: "BOLT_BEAM_1" }],
        objectIdsText: "",
        contactIndices: [],
      };
    case "rwall-rbe2":
      return {
        ...createDefaultRadiossTh("rwall-node"),
        role: "rwall-rbe2",
        title: "TH_RBE2_MAIN_NODES",
        variables: ["D", "V", "A", "REACX", "REACY", "REACZ", "REACXX", "REACYY", "REACZZ"],
        nodeEntries: [{ nodeId: "", skewId: "0", label: "RBE2_MAIN_NODE" }],
      };
    case "rbody":
      return {
        enabled: true,
        kind: "rbody",
        role: "rbody",
        title: "TH_FIXTURE_RBODY",
        variables: ["DEF"],
        nodeEntries: [],
        elemEntries: [],
        objectIdsText: "",
        contactIndices: [],
      };
    case "rwall":
      return {
        enabled: true,
        kind: "rwall",
        role: "rwall",
        title: "TH_RIGID_WALL",
        variables: ["DEF"],
        nodeEntries: [],
        elemEntries: [],
        objectIdsText: "",
        contactIndices: [],
      };
    case "rwall-node":
      return {
        enabled: true,
        kind: "node",
        role: "rwall-node",
        title: "TH_RWALL_NODES",
        variables: ["DX", "DY", "DZ", "AX", "AY", "AZ", "REACX", "REACY", "REACZ"],
        nodeEntries: [{ nodeId: "", skewId: "0", label: "RWALL_NODE_1" }],
        elemEntries: [],
        objectIdsText: "",
        contactIndices: [],
      };
    case "contact":
      return {
        enabled: true,
        kind: "inter",
        role: "contact",
        title: "TH_TOOL_MODEL_INTER",
        variables: ["FNX", "FNY", "FNZ", "FTX", "FTY", "FTZ"],
        nodeEntries: [],
        elemEntries: [],
        objectIdsText: "",
        contactIndices: [],
      };
    case "sectio":
      return {
        enabled: true,
        kind: "sectio",
        role: "bolt",
        title: "TH_BOLT_SECTION",
        variables: ["FNX", "FNY", "FNZ", "FTX", "FTY", "FTZ", "M1", "M2", "M3", "WORK"],
        nodeEntries: [],
        elemEntries: [],
        objectIdsText: "",
        contactIndices: [],
      };
    case "part":
      return {
        enabled: true,
        kind: "part",
        role: "part",
        title: "TH_PART_ENERGY",
        variables: ["IE", "KE", "MASS"],
        nodeEntries: [],
        elemEntries: [],
        objectIdsText: "",
        contactIndices: [],
      };
  }
}

export function createDefaultRadiossFunction(index = 1): Draft {
  return {
    title: `CUSTOM_FUNCT_${index}`,
    explicitId: "",
    note: "",
    points: [
      { time: "0", value: "0" },
      { time: "0.05", value: "1" },
      { time: "0.1", value: "1" },
    ],
  };
}

const DEFAULT_ENGINE_CONTROL: Draft = {
  emitVers: true,
  versionNum: "2022",
  parithMode: "ON",
  emitPrint: true,
  nPrint: "-1000",
  nLine: "0",
  tfileType: "0",
  emitTfile: true,
  thVersion: "",
  animElem: ["EPSP", "ENERGY", "VONM", "PRES", "HOURG"],
  animNoda: ["DMAS"],
  animVect: ["ACC", "CONT", "DISP"],
};

const RADIOSS_DEFAULTS: Draft = {
  solverVersion: "2022",
  inputMass: "kg",
  inputLength: "mm",
  inputTime: "ms",
  workMass: "kg",
  workLength: "mm",
  workTime: "ms",
  confirmModel: false,
  loadKind: "node",
  loadNodeId: "1001",
  loadGrnodId: "",
  directionMode: "axis",
  direction: "X",
  directionVector: ["0", "0", "-1"],
  vectorOrigin: ["0", "0", "0"],
  curve: [
    { time: "0", value: "0" },
    { time: "0.05", value: "40" },
    { time: "0.1", value: "40" },
  ],
  tStart: "",
  tStop: "",
  skewId: "",
  constraints: [
    {
      kind: "nodes",
      nodeIds: "2001,2002",
      grnodId: "",
      dofs: [true, true, true, false, false, false],
      skewId: "",
    },
  ],
  contacts: [],
  endTime: "0.1",
  animStart: "0",
  animInterval: "0.01",
  thInterval: "0.001",
  timeStepMode: "natural",
  timeStepScale: "0.9",
  timeStepTarget: "0.001",
  amsPartGroupId: "",
  engineControl: DEFAULT_ENGINE_CONTROL,
  gravityEnabled: false,
  gravityMagnitude: "0",
  gravityDir: "Z",
  gravities: [],
  functions: [],
  timeHistories: [
    {
      ...createDefaultRadiossTh("bolt"),
      enabled: false,
    },
    { ...createDefaultRadiossTh("rwall-rbe2"), enabled: false },
    { ...createDefaultRadiossTh("rwall-node"), enabled: false },
    {
      ...createDefaultRadiossTh("rwall"),
      enabled: false,
    },
  ],
  generatedStart: "800000",
  occupiedRanges: "",
};

export const INITIAL_DRAFTS: Record<string, Draft> = {
  "radioss-rops": {
    ...RADIOSS_DEFAULTS,
    name: "ROPS_CASE_1",
    runName: "ROPS_CASE",
  },
  "radioss-fops": {
    ...RADIOSS_DEFAULTS,
    name: "FOPS_CASE_1",
    runName: "FOPS_CASE",
    direction: "-Z",
    loadNodeId: "3001",
    curve: [
      { time: "0", value: "0" },
      { time: "0.01", value: "30" },
      { time: "0.05", value: "30" },
    ],
    constraints: [
      {
        kind: "nodes",
        nodeIds: "4001,4002",
        grnodId: "",
        dofs: [true, true, true, true, true, true],
        skewId: "",
      },
    ],
    endTime: "0.05",
    animInterval: "0.005",
    thInterval: "0.0005",
    gravities: [
      createDefaultRadiossGravity({ fops: true, mode: "curve", title: "FOPS_GRAV_Z", oneG: 0.00980665, endTime: 0.05 }),
    ],
    impact: { dropMassKg: "300", dropHeightMm: "3000", gravityG: "1" },
  },
  "nodal-static": {
    name: "Nodal_Static_1",
    modelUnits: "N-mm-s",
    solverVersion: "2022",
    existingSpcSetId: "900001",
    perRowSubcase: false,
    outputProfile: "STATIC_BASIC",
    loads: [
      {
        nodeId: "1001",
        cid: "0",
        fx: "",
        fy: "",
        fz: "-1000",
        mx: "",
        my: "",
        mz: "",
        label: "Load_Pt_1",
      },
    ],
  },
  constraint: {
    name: "Constraint_1",
    modelUnits: "N-mm-s",
    mode: "new",
    existingSpcSetIds: "",
    combineWithExisting: false,
    rows: [{ nodeId: "2001", dofs: "123", value: "", cid: "0" }],
  },
  gravity: {
    name: "Gravity_Cases",
    modelUnits: "N-mm-s",
    existingSpcSetId: "900001",
    outputProfile: "STATIC_BASIC",
    cases: [
      {
        name: "Gravity_Z",
        acceleration: "9806.65",
        nx: "0",
        ny: "0",
        nz: "-1",
        cid: "0",
      },
    ],
  },
  "normal-modes": {
    name: "Normal_Modes",
    modelUnits: "N-mm-s",
    existingSpcSetId: "900001",
    eigrlMinHz: "0",
    eigrlMaxHz: "300",
    numModes: "10",
    outputProfile: "MODAL_BASIC",
  },
  "frequency-response": {
    name: "Frequency_Response",
    modelUnits: "N-mm-s",
    existingSpcSetId: "900001",
    loadId: "",
    minHz: "10",
    maxHz: "200",
    stepHz: "1",
    eigrlMinHz: "0",
    eigrlMaxHz: "300",
    dampingRatio: "0.02",
    outputProfile: "MFREQ_BASIC",
  },
  "random-psd": {
    name: "Random_PSD_Z",
    modelUnits: "N-mm-s",
    solverVersion: "2022",
    excKind: "base-acceleration",
    nodeId: "1001",
    component: "3",
    existingSpcSetId: "9001",
    inputPsdUnit: "g^2/Hz",
    referenceAmplitudeG: "1",
    forceCid: "0",
    forceDirection: ["0", "0", "1"],
    referenceForceN: "1",
    interpolation: "LOG-LOG",
    outOfRange: "ERROR",
    points: [
      { frequencyHz: "10", psd: "0.003" },
      { frequencyHz: "100", psd: "0.006" },
      { frequencyHz: "200", psd: "0.003" },
    ],
    minHz: "10",
    maxHz: "200",
    stepHz: "1",
    modalMinHz: "0",
    modalMaxHz: "300",
    modalSolver: "LANCZOS",
    modalMethod: "LANCZOS",
    eigraV1: "0",
    eigraV2: "300",
    eigraNd: "",
    eigraMsglvl: "0",
    eigraAmpffact: "5",
    eigraNorm: "MASS",
    excForm: "RLOAD2",
    freqKind: "FREQ1",
    freqNf: "10",
    explicitHzText: "10, 20, 50, 100, 150, 200",
    axisMode: "single",
    dampingRatio: "0.02",
    outputProfile: "PSD_AND_RMS",
    stress: true,
    displacement: true,
    acceleration: true,
    confirmSpc: false,
  },
};

export const PSD_SAMPLE_POINTS: Array<{ frequencyHz: string; psd: string }> = [
  { frequencyHz: "10", psd: "0.003" },
  { frequencyHz: "20", psd: "0.01" },
  { frequencyHz: "50", psd: "0.02" },
  { frequencyHz: "100", psd: "0.006" },
  { frequencyHz: "200", psd: "0.003" },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Recursively merge an imported or cached draft onto module defaults.
 * Arrays and primitives replace defaults directly; plain objects merge field-by-field
 * so newly added fields in newer app versions retain their default values.
 */
export function mergeDraftValues<T extends Draft>(defaults: T, incoming: unknown): T {
  const base = JSON.parse(JSON.stringify(defaults)) as Draft;
  if (!isPlainObject(incoming)) return base as T;
  for (const [key, val] of Object.entries(incoming)) {
    if (val === undefined) continue;
    if (Array.isArray(val)) {
      base[key] = JSON.parse(JSON.stringify(val));
    } else if (isPlainObject(val) && isPlainObject(base[key])) {
      base[key] = mergeDraftValues(base[key] as Draft, val);
    } else if (isPlainObject(val)) {
      base[key] = JSON.parse(JSON.stringify(val));
    } else {
      base[key] = val;
    }
  }
  if (defaults.engineControl && (!Array.isArray(incoming.gravities) || incoming.gravities.length === 0) && "gravityEnabled" in incoming) {
    base.gravities = incoming.gravityEnabled
      ? [{
          ...createDefaultRadiossGravity({ mode: "constant", title: "GRAV" }),
          direction: String(incoming.gravityDir || "Z"),
          magnitude: String(incoming.gravityMagnitude ?? "0"),
          fScale: "",
        }]
      : [];
    base.gravityEnabled = false;
  }
  if (defaults.engineControl && Array.isArray(base.timeHistories)) {
    base.timeHistories = (base.timeHistories as Draft[]).map((row) => {
      if (row.kind === "rbody" && row.role === "rwall-rbe2") {
        if (String(row.objectIdsText).trim() === "0") return { ...createDefaultRadiossTh("rwall-rbe2"), enabled: false };
        return { ...row, role: "rbody" };
      }
      if (!Array.isArray(row.variables)) return row;
      const variables = (row.variables as string[]).flatMap((variable) => {
        if (row.kind === "spring" && variable === "FAIL") return ["OFF"];
        if (row.kind === "beam" && variable === "EPSP") return [];
        if (row.kind === "node" && variable === "REAC") return ["REACX", "REACY", "REACZ"];
        return [variable];
      });
      return { ...row, variables: [...new Set(variables)] };
    });
  }
  return base as T;
}

export function createInitialDrafts(): Record<string, Draft> {
  return JSON.parse(JSON.stringify(INITIAL_DRAFTS)) as Record<string, Draft>;
}

export function mergeWithInitialDrafts(partial: Record<string, Draft> | null | undefined): Record<string, Draft> {
  const base = createInitialDrafts();
  if (!isPlainObject(partial)) return base;
  for (const [key, incoming] of Object.entries(partial)) {
    if (!isPlainObject(incoming)) continue;
    if (key === "gravity" && !Array.isArray(incoming.cases)) {
      const units = String(incoming.modelUnits || "N-mm-s");
      const oneG = units === "N-m-s" ? 9.80665 : 9806.65;
      const magG = num(incoming.magnitudeG) || 1;
      const dir = Array.isArray(incoming.direction) ? incoming.direction : ["0", "0", "-1"];
      base.gravity = mergeDraftValues(base.gravity, {
        name: incoming.name ?? base.gravity.name,
        modelUnits: units,
        existingSpcSetId: incoming.existingSpcSetId ?? base.gravity.existingSpcSetId,
        outputProfile: incoming.outputProfile ?? base.gravity.outputProfile,
        cases: [
          {
            name: String(incoming.name || "Gravity_Z"),
            acceleration: String(Number((magG * oneG).toFixed(5))),
            nx: String(dir[0] ?? "0"),
            ny: String(dir[1] ?? "0"),
            nz: String(dir[2] ?? "-1"),
            cid: String(incoming.cid ?? "0"),
          },
        ],
      });
    } else if (base[key]) {
      base[key] = mergeDraftValues(base[key], incoming);
    } else {
      base[key] = JSON.parse(JSON.stringify(incoming)) as Draft;
    }
  }
  return base;
}

function buildRadiossParameters(d: Draft): Record<string, unknown> {
  const timeStep =
    d.timeStepMode === "noda-cst"
      ? { mode: "noda-cst", scale: num(d.timeStepScale), target: num(d.timeStepTarget) }
      : d.timeStepMode === "ams"
        ? {
            mode: "ams",
            scale: num(d.timeStepScale),
            target: num(d.timeStepTarget),
            amsPartGroupId: optInt(d.amsPartGroupId),
          }
        : { mode: "natural" };
  const ctrl = (d.engineControl ?? {}) as Draft;
  const parithVal =
    ctrl.parithMode === "OFF" ? false : ctrl.parithMode === "OMIT" ? undefined : true;
  const gravitiesList = Array.isArray(d.gravities) ? (d.gravities as Draft[]) : [];
  const timeHistoriesList = Array.isArray(d.timeHistories) ? (d.timeHistories as Draft[]) : [];
  const functionsList = Array.isArray(d.functions) ? (d.functions as Draft[]) : [];

  return {
    name: d.name,
    runName: d.runName,
    solverVersion: d.solverVersion,
    units: {
      input: { mass: d.inputMass, length: d.inputLength, time: d.inputTime },
      work: { mass: d.workMass, length: d.workLength, time: d.workTime },
      confirmedAgainstTargetModel: Boolean(d.confirmModel),
    },
    references: {
      loadTarget:
        d.loadKind === "grnod"
          ? { kind: "grnod", grnodId: num(d.loadGrnodId) }
          : { kind: "node", nodeId: num(d.loadNodeId) },
      constraints: (d.constraints as Draft[]).map((row) => ({
        target:
          row.kind === "grnod"
            ? { kind: "grnod", grnodId: num(row.grnodId) }
            : { kind: "nodes", nodeIds: parseIdList(row.nodeIds) },
        dofs: [0, 1, 2, 3, 4, 5].map((i) => Boolean((row.dofs as boolean[])[i])),
        skewId: optInt(row.skewId),
      })),
    },
    loading: {
      directionMode: d.directionMode || "axis",
      direction: d.direction,
      directionVector:
        d.directionMode === "vector"
          ? ((d.directionVector as string[]) ?? ["0", "0", "-1"]).map(num)
          : undefined,
      vectorOrigin:
        d.directionMode === "vector"
          ? ((d.vectorOrigin as string[]) ?? ["0", "0", "0"]).map(num)
          : undefined,
      curve: (d.curve as Draft[]).map((p) => ({ time: num(p.time), value: num(p.value) })),
      tStart: optNum(d.tStart),
      tStop: optNum(d.tStop),
      skewId: d.directionMode === "vector" ? undefined : optInt(d.skewId),
    },
    engine: {
      endTime: num(d.endTime),
      animation: { startTime: num(d.animStart), interval: num(d.animInterval) },
      timeHistoryInterval: num(d.thInterval),
      timeStep,
      control: {
        emitVers: ctrl.emitVers !== false,
        versionNum: optInt(ctrl.versionNum) ?? 2022,
        parith: parithVal,
        emitPrint: ctrl.emitPrint !== false,
        nPrint: optInt(ctrl.nPrint) ?? -1000,
        nLine: optInt(ctrl.nLine) ?? 0,
        tfileType: optInt(ctrl.tfileType) ?? 0,
        emitTfile: ctrl.emitTfile !== false,
        thVersion: optInt(ctrl.thVersion),
        animElem: Array.isArray(ctrl.animElem) ? ctrl.animElem : [],
        animNoda: Array.isArray(ctrl.animNoda) ? ctrl.animNoda : [],
        animVect: Array.isArray(ctrl.animVect) ? ctrl.animVect : [],
      },
    },
    gravity:
      gravitiesList.length === 0 && d.gravityEnabled
        ? { enabled: true, magnitude: num(d.gravityMagnitude), direction: d.gravityDir }
        : undefined,
    gravities: gravitiesList.map((g) => ({
      enabled: g.enabled !== false,
      title: String(g.title ?? ""),
      mode: String(g.mode || "constant"),
      magnitude: num(g.magnitude),
      direction: String(g.direction || "-Z"),
      aScale: optNum(g.aScale) ?? 1.0,
      fScale: optNum(g.fScale),
      existingFunctId: optInt(g.existingFunctId),
      curve: Array.isArray(g.curve)
        ? (g.curve as Draft[]).map((p) => ({ time: num(p.time), value: num(p.value) }))
        : [],
      skewId: optInt(g.skewId),
      sensorId: optInt(g.sensorId),
      grnodId: optInt(g.grnodId),
    })),
    functions: functionsList.map((fn) => ({
      title: String(fn.title ?? ""),
      explicitId: optInt(fn.explicitId),
      note: String(fn.note ?? ""),
      points: Array.isArray(fn.points)
        ? (fn.points as Draft[]).map((p) => ({ time: num(p.time), value: num(p.value) }))
        : [],
    })),
    timeHistories: timeHistoriesList.map((th) => ({
      enabled: th.enabled !== false,
      kind: String(th.kind || "node"),
      role: String(th.role || "custom"),
      title: String(th.title ?? ""),
      variables: Array.isArray(th.variables) ? th.variables : [],
      nodes: Array.isArray(th.nodeEntries)
        ? (th.nodeEntries as Draft[]).map((ne) => ({
            nodeId: optInt(ne.nodeId) ?? 0,
            skewId: optInt(ne.skewId) ?? 0,
            label: String(ne.label ?? ""),
          }))
        : [],
      elements: Array.isArray(th.elemEntries)
        ? (th.elemEntries as Draft[]).map((ee) => ({
            elemId: optInt(ee.elemId) ?? 0,
            label: String(ee.label ?? ""),
          }))
        : [],
      objectIds: parseIdList(th.objectIdsText),
      contactIndices: Array.isArray(th.contactIndices) ? th.contactIndices : [],
    })),
    contacts: (Array.isArray(d.contacts) ? (d.contacts as Draft[]) : []).map((ct) => ({
      title: String(ct.title ?? ""),
      slaveGrnodId: optInt(ct.slaveGrnodId) ?? 0,
      masterSurfId: optInt(ct.masterSurfId) ?? 0,
      istf: optInt(ct.istf) ?? 4,
      ithe: optInt(ct.ithe) ?? 0,
      thermal: Number(ct.ithe) === 1 ? {
        coefficient: optNum(ct.heatCoefficient) ?? 0,
        functionId: optInt(ct.heatFunctionId) ?? 0,
        interfaceTemperature: optNum(ct.heatInterfaceTemperature) ?? 0,
        formulation: optInt(ct.heatFormulation) ?? 0,
        pressureScale: optNum(ct.heatPressureScale) ?? 1,
        radiationFactor: optNum(ct.heatRadiationFactor) ?? 0,
        radiationDistance: optNum(ct.heatRadiationDistance) ?? 0,
        secondaryFrictionHeat: optNum(ct.heatSecondaryFriction) ?? 0,
        mainFrictionHeat: optNum(ct.heatMainFriction) ?? 0,
      } : undefined,
      igap: optInt(ct.igap) ?? 2,
      ibag: optInt(ct.ibag) ?? 0,
      idel: optInt(ct.idel) ?? 2,
      icurv: optInt(ct.icurv) ?? 0,
      iadm: optInt(ct.iadm) ?? 0,
      curvNodeId1: optInt(ct.curvNodeId1),
      curvNodeId2: optInt(ct.curvNodeId2),
      fscaleGap: optNum(ct.fscaleGap) ?? 1.0,
      gapMax: optNum(ct.gapMax) ?? 0,
      fpenmax: optNum(ct.fpenmax) ?? 0,
      iTied: optInt(ct.iTied) ?? 0,
      stMin: optNum(ct.stMin) ?? 0,
      stMax: optNum(ct.stMax) ?? 0,
      percentMeshSize: optNum(ct.percentMeshSize) ?? 0.4,
      dtmin: optNum(ct.dtmin) ?? 0,
      iremGap: optInt(ct.iremGap) ?? 2,
      iremI2: optInt(ct.iremI2) ?? 0,
      stfac: optNum(ct.stfac) ?? 1.0,
      fric: optNum(ct.fric) ?? 0,
      gapMin: optNum(ct.gapMin) ?? 0,
      tStart: optNum(ct.tStart) ?? 0,
      tStop: optNum(ct.tStop) ?? 0,
      ibc: String(ct.ibc ?? "000").trim() || "000",
      inacti: optInt(ct.inacti) ?? 6,
      visS: optNum(ct.visS) ?? 0,
      visF: optNum(ct.visF) ?? 0,
      bumult: optNum(ct.bumult) ?? 0,
      ifric: optInt(ct.ifric) ?? 0,
      ifiltr: optInt(ct.ifiltr) ?? 0,
      xfreq: optNum(ct.xfreq) ?? 0,
      iform: optInt(ct.iform) ?? 2,
      sensId: optInt(ct.sensId) ?? 0,
      fctIdF: optInt(ct.fctIdF) ?? 0,
      ascaleF: optNum(ct.ascaleF) ?? 0,
      fricId: optInt(ct.fricId) ?? 0,
      c1: optNum(ct.c1) ?? 0,
      c2: optNum(ct.c2) ?? 0,
      c3: optNum(ct.c3) ?? 0,
      c4: optNum(ct.c4) ?? 0,
      c5: optNum(ct.c5) ?? 0,
      c6: optNum(ct.c6) ?? 0,
    })),
    idPolicy: {
      generatedStart: num(d.generatedStart),
      manuallyOccupiedRanges: parseRanges(d.occupiedRanges),
    },
  };
}

export interface RadiossFunctionExportPreview {
  id: number;
  title: string;
  role: string;
  xLabel: string;
  yLabel: string;
  points: Array<{ time: number; value: number }>;
}

/** Collect all Radioss `/FUNCT` curves in the current draft (displacement, gravity curves, extra functions) for tabular preview/export. */
export function collectRadiossFunctionsForExport(d: Draft): RadiossFunctionExportPreview[] {
  const baseStart = optInt(d.generatedStart) ?? 800000;
  let nextFunctId = baseStart + 10001;
  const ranges = parseRanges(d.occupiedRanges).map(([a, b]) => [Math.min(a, b), Math.max(a, b)]);
  const allocate = () => {
    for (let range = ranges.find(([a, b]) => nextFunctId >= a && nextFunctId <= b);
      range; range = ranges.find(([a, b]) => nextFunctId >= a && nextFunctId <= b)) {
      nextFunctId = range[1] + 1;
    }
    return nextFunctId++;
  };
  const asciiTitle = (value: unknown) => String(value).replace(/[^a-zA-Z0-9_.-]/gu, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "CASE";
  const stem = asciiTitle(d.name || "CASE");
  const timeUnit = String(d.workTime || "ms");
  const lenUnit = String(d.workLength || "mm");
  const out: RadiossFunctionExportPreview[] = [];

  out.push({
    id: allocate(),
    title: `${stem}_DISP`,
    role: "受控位移曲线 (/IMPDISP)",
    xLabel: `时间 (${timeUnit})`,
    yLabel: `位移 (${lenUnit})`,
    points: (Array.isArray(d.curve) ? (d.curve as Draft[]) : []).map((p) => ({
      time: num(p.time),
      value: num(p.value),
    })),
  });

  const gravs = Array.isArray(d.gravities) ? (d.gravities as Draft[]) : [];
  gravs.forEach((g, idx) => {
    if (g.enabled !== false && g.mode === "curve" && !(Number(g.existingFunctId) > 0) && Array.isArray(g.curve)) {
      const gTitle = String(g.title ?? "").trim() ? asciiTitle(g.title) : `${stem}_GRAV${gravs.length > 1 ? `_${idx + 1}` : ""}`;
      out.push({
        id: allocate(),
        title: `${gTitle}_FUNCT`,
        role: `重力加载曲线 (/GRAV #${idx + 1})`,
        xLabel: `时间 (${timeUnit})`,
        yLabel: `曲线幅值 (×Fscale_Y=${g.fScale || g.magnitude || "1"})`,
        points: (g.curve as Draft[]).map((p) => ({ time: num(p.time), value: num(p.value) })),
      });
    }
  });

  const extras = Array.isArray(d.functions) ? (d.functions as Draft[]) : [];
  extras.forEach((fn, idx) => {
    const eid = optInt(fn.explicitId);
    const fid = eid && eid > 0 ? eid : allocate();
    out.push({
      id: fid,
      title: String(fn.title ?? "").trim() ? asciiTitle(fn.title) : `${stem}_FUNCT_${idx + 1}`,
      role: String(fn.note || "自定义曲线 (/FUNCT)"),
      xLabel: `X (${timeUnit})`,
      yLabel: "Y (Value)",
      points: (Array.isArray(fn.points) ? (fn.points as Draft[]) : []).map((p) => ({
        time: num(p.time),
        value: num(p.value),
      })),
    });
  });

  return out;
}

export function renderRadiossFunctionsCsvClient(items: RadiossFunctionExportPreview[]): string {
  const esc = (v: string) => (/[,"\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  const lines = ["\ufeffFunction_ID,Function_Title,Role,Point_Index,X,Y"];
  items.forEach((fn) => {
    fn.points.forEach((pt, idx) => {
      lines.push(`${fn.id},${esc(fn.title)},${esc(fn.role)},${idx + 1},${pt.time},${pt.value}`);
    });
  });
  return lines.join("\n") + "\n";
}

export function buildParameters(id: string, d: Draft): Record<string, unknown> {
  switch (id) {
    case "radioss-rops":
      return buildRadiossParameters(d);
    case "radioss-fops":
      return {
        base: buildRadiossParameters(d),
        impact: {
          dropMassKg: num(d.impact?.dropMassKg),
          dropHeightMm: num(d.impact?.dropHeightMm),
          gravityG: optNum(d.impact?.gravityG) ?? 1,
        },
      };
    case "nodal-static":
      return {
        name: d.name,
        modelUnits: d.modelUnits,
        solverVersion: d.solverVersion,
        existingSpcSetId: optInt(d.existingSpcSetId),
        perRowSubcase: Boolean(d.perRowSubcase),
        outputProfile: d.outputProfile || "STATIC_BASIC",
        loads: (d.loads as Draft[]).map((r) => ({
          nodeId: num(r.nodeId),
          cid: num(r.cid),
          fx: num(r.fx),
          fy: num(r.fy),
          fz: num(r.fz),
          mx: num(r.mx),
          my: num(r.my),
          mz: num(r.mz),
          label: r.label || "",
        })),
      };
    case "constraint":
      return {
        name: d.name,
        modelUnits: d.modelUnits,
        mode: d.mode,
        combineWithExisting: Boolean(d.combineWithExisting),
        existingSpcSetIds: parseIdList(d.existingSpcSetIds),
        rows: (d.rows as Draft[]).map((r) => ({
          nodeId: num(r.nodeId),
          dofs: parseDofs(r.dofs),
          value: optNum(r.value) ?? 0,
          cid: num(r.cid),
        })),
      };
    case "gravity": {
      const rows = (Array.isArray(d.cases) ? d.cases : []) as Draft[];
      return {
        name: d.name,
        modelUnits: d.modelUnits,
        existingSpcSetId: optInt(d.existingSpcSetId),
        outputProfile: d.outputProfile || "STATIC_BASIC",
        cases: rows.map((r) => ({
          name: String(r.name ?? ""),
          acceleration: num(r.acceleration),
          nx: num(r.nx),
          ny: num(r.ny),
          nz: num(r.nz),
          cid: num(r.cid),
        })),
      };
    }
    case "normal-modes":
      return {
        name: d.name,
        modelUnits: d.modelUnits,
        existingSpcSetId: optInt(d.existingSpcSetId),
        eigrlMinHz: optNum(d.eigrlMinHz),
        eigrlMaxHz: optNum(d.eigrlMaxHz),
        numModes: optInt(d.numModes),
        outputProfile: d.outputProfile || "MODAL_BASIC",
      };
    case "frequency-response":
      return {
        name: d.name,
        modelUnits: d.modelUnits,
        existingSpcSetId: num(d.existingSpcSetId),
        loadId: optInt(d.loadId),
        frequencyMinHz: num(d.minHz),
        frequencyMaxHz: num(d.maxHz),
        frequencyStepHz: num(d.stepHz),
        eigrlMinHz: num(d.eigrlMinHz),
        eigrlMaxHz: num(d.eigrlMaxHz),
        dampingRatio: num(d.dampingRatio),
      };
    case "random-psd": {
      const baseAccel = d.excKind === "base-acceleration";
      const freqKind = d.freqKind ?? "FREQ1";
      return {
        name: d.name,
        modelUnits: d.modelUnits,
        solverVersion: d.solverVersion,
        excitation: baseAccel
          ? {
              kind: "base-acceleration",
              nodeId: num(d.nodeId),
              component: num(d.component),
              existingSpcSetId: num(d.existingSpcSetId),
              inputPsdUnit: d.inputPsdUnit,
              referenceAmplitudeG: num(d.referenceAmplitudeG) || 1,
            }
          : {
              kind: "applied-force",
              nodeId: num(d.nodeId),
              cid: num(d.forceCid),
              direction: ((d.forceDirection as string[]) ?? ["0", "0", "1"]).map(num),
              existingSpcSetId: num(d.existingSpcSetId),
              inputPsdUnit: d.inputPsdUnit,
              referenceForceN: num(d.referenceForceN) || 1,
            },
        spectrum: {
          interpolation: d.interpolation,
          outOfRange: d.outOfRange,
          points: (d.points as Draft[]).map((p) => ({
            frequencyHz: num(p.frequencyHz),
            psd: num(p.psd),
          })),
        },
        frequency: {
          minHz: num(d.minHz),
          maxHz: num(d.maxHz),
          stepHz: num(d.stepHz),
          kind: freqKind,
          nf: freqKind === "FREQ2" ? optInt(d.freqNf) ?? 10 : undefined,
          explicitHz: freqKind === "FREQ" ? parseFloatList(d.explicitHzText) : [],
        },
        modal: {
          minHz: num(d.modalMinHz),
          maxHz: num(d.modalMaxHz),
          solver: d.modalMethod === "EIGRA" ? "AMSES" : d.modalSolver ?? "LANCZOS",
        },
        axisMode: d.axisMode ?? "single",
        excitationForm: d.excForm ?? "RLOAD2",
        eigra:
          d.modalMethod === "EIGRA"
            ? {
                v1Hz: optNum(d.eigraV1),
                v2Hz: num(d.eigraV2),
                nd: optInt(d.eigraNd),
                msglvl: optInt(d.eigraMsglvl),
                ampffact: optNum(d.eigraAmpffact),
                norm: d.eigraNorm || "MASS",
              }
            : undefined,
        damping: { kind: "modal-critical-ratio", ratio: num(d.dampingRatio) },
        output: {
          profile: d.outputProfile,
          h3d: true,
          stress: Boolean(d.stress),
          displacement: Boolean(d.displacement),
          acceleration: Boolean(d.acceleration),
        },
        confirmExcitedDofInSpc: Boolean(d.confirmSpc),
      };
    }
    default:
      return {};
  }
}
