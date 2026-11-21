/**
 * Inline icon set (image-free). Every icon is decorative: `aria-hidden` + `focusable="false"`.
 * Shapes follow the VS Code codicon geometry (16 px grid, currentColor strokes).
 */
import type { SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
}

function Svg({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.4 2.6l3 3L6 13H3v-3z" />
      <path d="M9 4l3 3" />
    </Svg>
  );
}

export function SaveIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 2.5h8l3 3v8h-11z" />
      <path d="M5 2.5v3.5h5.5V2.5" />
      <path d="M5 12.5v-3h6v3" />
    </Svg>
  );
}

export function FileAddIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 1.5H4a1 1 0 00-1 1v11a1 1 0 001 1h8a1 1 0 001-1V5.5z" />
      <path d="M9 1.5v4h4" />
      <path d="M5.5 10.5h5M8 8v5" />
    </Svg>
  );
}

export function FileRemoveIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 1.5H4a1 1 0 00-1 1v11a1 1 0 001 1h8a1 1 0 001-1V5.5z" />
      <path d="M9 1.5v4h4" />
      <path d="M5.5 10.5h5" />
    </Svg>
  );
}

export function FileRenameIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 1.5H4a1 1 0 00-1 1v11a1 1 0 001 1h8a1 1 0 001-1V5.5z" />
      <path d="M9 1.5v4h4" />
      <path d="M5.5 11.5l5-5M8 6.5h2.5V9" />
    </Svg>
  );
}

export function FileChangeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 1.5H4a1 1 0 00-1 1v11a1 1 0 001 1h8a1 1 0 001-1V5.5z" />
      <path d="M9 1.5v4h4" />
      <circle cx="8" cy="10.5" r="1.4" />
    </Svg>
  );
}

export function TaskIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M4.5 6.5l1.5 1.5 3-3M4.5 11.5l1.5 1.5 3-3" />
    </Svg>
  );
}

export function DebugIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 4.5h12M2 11.5h12M4.5 4.5v7M11.5 4.5v7" />
      <path d="M6 8h4" />
    </Svg>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M4.5 6l2 2-2 2M8.5 10.5h3" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6.5l4 4 4-4" />
    </Svg>
  );
}

export function ChevronStartIcon(props: IconProps) {
  return (
    <Svg {...props} className={`flip-inline ${props.className ?? ""}`}>
      <path d="M10 4l-4 4 4 4" />
    </Svg>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.5v11M3.5 9.5L8 14l4.5-4.5" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2L14 14" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </Svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
      <path d="M10.5 5.5v-2a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h2" />
    </Svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3.5v9M10 3.5v9" strokeWidth={1.8} />
    </Svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 3l8 5-8 5z" />
    </Svg>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 3.5h12L9.5 8.5v4L6.5 14V8.5z" />
    </Svg>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="3.5" cy="8" r="1" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="12.5" cy="8" r="1" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 4.5h11M6 4.5V2.8h4v1.7M4 4.5l.7 9h6.6l.7-9" />
    </Svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.5v7.5M4.5 6.5L8 10l3.5-3.5M2.5 13.5h11" />
    </Svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7v4M8 4.8v.4" />
    </Svg>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.5 2.5h4v4M13.5 2.5L7.5 8.5" />
      <path d="M12 9.5v3a1 1 0 01-1 1H3.5a1 1 0 01-1-1V5a1 1 0 011-1h3" />
    </Svg>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <Svg {...props} strokeWidth={1.2}>
      <path d="M8 13.5S2.5 10.2 2.5 6.3A2.8 2.8 0 017.6 4.6L8 5l.4-.4a2.8 2.8 0 015.1 1.7c0 3.9-5.5 7.2-5.5 7.2z" />
    </Svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
    </Svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2l1.4 4.1L13.5 7.5l-4.1 1.4L8 13l-1.4-4.1L2.5 7.5l4.1-1.4z" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 8.5l3 3 6-6.5" />
    </Svg>
  );
}
