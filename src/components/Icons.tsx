import type { ReactNode } from "react";

type IconProps = { size?: number; className?: string };

function Svg({ size = 18, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ClipboardIcon = (p: IconProps) => (
  <Svg {...p}><rect x="8" y="3" width="8" height="4" rx="1" /><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><path d="M8 11h8M8 15h5" /></Svg>
);

export const TableIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16M15 4v16" /></Svg>
);

export const LayersIcon = (p: IconProps) => (
  <Svg {...p}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /><path d="m3 17 9 5 9-5" /></Svg>
);

export const NodeIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="18" r="2.4" /><path d="M10.6 8 7.4 15.8M13.4 8l3.2 7.8M8.4 18h7.2" /></Svg>
);

export const HashIcon = (p: IconProps) => (
  <Svg {...p}><path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18" /></Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 19h16" /></Svg>
);

export const UploadIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M4 19h16" /></Svg>
);

export const CopyIcon = (p: IconProps) => (
  <Svg {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></Svg>
);

export const SaveIcon = (p: IconProps) => (
  <Svg {...p}><path d="M5 3h11l3 3v15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M8 3v6h7V3" /><path d="M8 21v-7h8v7" /></Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 14h10l1-14" /><path d="M10 11v6M14 11v6" /></Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}><path d="m5 12 4.5 4.5L19 7" /></Svg>
);

export const WarningIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v5" /><path d="M12 17.5h.01" /></Svg>
);

export const ResetIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 5v5h5" /><path d="M5.5 10a7.5 7.5 0 1 1-.6 4" /></Svg>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Svg {...p}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></Svg>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <Svg {...p}><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></Svg>
);

export const XIcon = (p: IconProps) => (
  <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>
);

export const SpinnerIcon = ({ className, size = 16 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className={className ? `spin ${className}` : "spin"} aria-hidden="true">
    <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
    <path d="M21 12a9 9 0 0 0-9-9" />
  </svg>
);

export const FolderIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></Svg>
);

export const FileIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" /><path d="M14 3v6h6" /></Svg>
);

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></Svg>
);

export const ToolboxIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="3" width="8" height="8" rx="1.8" /><rect x="13" y="3" width="8" height="8" rx="1.8" /><rect x="3" y="13" width="8" height="8" rx="1.8" /><rect x="13" y="13" width="8" height="8" rx="1.8" /></Svg>
);

export const PinIcon = ({ size = 18, className, filled }: IconProps & { filled?: boolean }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>
);

export const GridViewIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="4" width="7" height="7" rx="1.2" /><rect x="14" y="4" width="7" height="7" rx="1.2" /><rect x="3" y="14" width="7" height="7" rx="1.2" /><rect x="14" y="14" width="7" height="7" rx="1.2" /></Svg>
);

export const CompactViewIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 6h16M4 12h16M4 18h16" /></Svg>
);

export const PlayCheckIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m9 12 2 2 4-4" /></Svg>
);

export const CodeIcon = (p: IconProps) => (
  <Svg {...p}><path d="m8 9-4 3 4 3" /><path d="m16 9 4 3-4 3" /><path d="m13 6-2 12" /></Svg>
);

export const ActivityIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 12h4l3-7 4 14 3-7h4" /></Svg>
);

export const ShieldAlertIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 3 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-3Z" /><path d="M12 9v4" /><path d="M12 16h.01" /></Svg>
);

export const FolderOpenIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H7l-4 9V7Z" /><path d="m7 10 14 0-2.5 9H4.5L7 10Z" /></Svg>
);

export const ForceVectorIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="6" cy="18" r="2.5" /><path d="M8 16 19 5" /><path d="M13 5h6v6" /></Svg>
);

export const ConstraintPinIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 4 5 16h14L12 4Z" /><path d="M3 20h18" /><path d="m6 20-2 2M10 20l-2 2M14 20l-2 2M18 20l-2 2" /></Svg>
);

export const GravityArrowIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="5" r="2" /><path d="M12 9v10" /><path d="m7 14 5 5 5-5" /><path d="M4 21h16" /></Svg>
);

export const ModesWaveIcon = (p: IconProps) => (
  <Svg {...p}><path d="M2 12c2.5-6 4.5-6 7 0s4.5 6 7 0 3.5-5 6 0" /></Svg>
);

export const FreqSweepIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 18h18" /><path d="M5 18V12M9 18V7M13 18V10M17 18V5M20 18v-4" /></Svg>
);

export const PsdSpectrumIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 4v16h16" /><path d="M6 16 10 9l4 2 4-5 2 8" /></Svg>
);

export const RopsRollIcon = (p: IconProps) => (
  <Svg {...p}><path d="M5 18V9a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v9" /><path d="M3 18h18" /><path d="M12 2v5" /><path d="m9.5 4.5 2.5 2.5 2.5-2.5" /></Svg>
);

export const FopsDropIcon = (p: IconProps) => (
  <Svg {...p}><rect x="7" y="3" width="10" height="5" rx="1" /><path d="M12 8v7" /><path d="m9 12 3 3 3-3" /><path d="M4 19h16" /></Svg>
);

export const LinkIcon = (p: IconProps) => (
  <Svg {...p}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></Svg>
);

export const ArrowUpIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></Svg>
);

export const ArrowDownIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 5v14" /><path d="m18 13-6 6-6-6" /></Svg>
);

export function ModuleGlyph({ id, size = 18, className }: { id: string; size?: number; className?: string }) {
  const props = { size, className };
  switch (id) {
    case "multi-case": return <LayersIcon {...props} />;
    case "tabular-load": return <TableIcon {...props} />;
    case "nodal-static": return <ForceVectorIcon {...props} />;
    case "constraint": return <ConstraintPinIcon {...props} />;
    case "gravity": return <GravityArrowIcon {...props} />;
    case "normal-modes": return <ModesWaveIcon {...props} />;
    case "frequency-response": return <FreqSweepIcon {...props} />;
    case "random-psd": return <PsdSpectrumIcon {...props} />;
    case "radioss-rops": return <RopsRollIcon {...props} />;
    case "radioss-fops": return <FopsDropIcon {...props} />;
    default: return <LayersIcon {...props} />;
  }
}
