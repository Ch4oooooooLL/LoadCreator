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
