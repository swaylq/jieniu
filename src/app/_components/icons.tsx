/** 内联描边图标（Lucide 风格，stroke=currentColor）。替代 App 里的 emoji 图标。 */
type IconProps = { className?: string };

function Svg({
  className = "h-6 w-6",
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function HomeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5" />
    </Svg>
  );
}

export function CompassIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.8 8.2 13.5 13.5 8.2 15.8 10.5 10.5Z" />
    </Svg>
  );
}

export function StarIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.2 14.6 8.5 20.4 9.3 16.2 13.4 17.2 19.2 12 16.5 6.8 19.2 7.8 13.4 3.6 9.3 9.4 8.5Z" />
    </Svg>
  );
}

export function AskIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-4 4v-4H5.5A1.5 1.5 0 0 1 4 14.5Z" />
      <path d="M9.2 9a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2-2.6 3.4" />
      <path d="M12 16.2h.01" />
    </Svg>
  );
}

export function CloseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function UserIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c0-4.1 3.4-6 7.5-6s7.5 1.9 7.5 6" />
    </Svg>
  );
}

export function BellIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </Svg>
  );
}

export function MoonIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </Svg>
  );
}

export function SunIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </Svg>
  );
}

export function ChevronDownIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function EyeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 12S5.5 5.5 12 5.5 21.5 12 21.5 12 18.5 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}
