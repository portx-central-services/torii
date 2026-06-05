/**
 * Inline SVG icons for the sidebar nav. Lucide-style, 1.75 stroke width,
 * 18×18 default. Ported from the PortX design system handoff so the sidebar
 * matches the Delivery Dashboard reference. Color comes from `currentColor`
 * so the active-state highlight on each NavLink propagates through.
 */
import type { SVGProps } from 'react';

const base: SVGProps<SVGSVGElement> = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

type IconProps = SVGProps<SVGSVGElement>;

export function DashboardIcon(p: IconProps) {
  // 2×2 grid of rounded panels — reads as "summary surfaces".
  return (
    <svg {...base} {...p}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  );
}

export function TimelineIcon(p: IconProps) {
  // Calendar with header divider + day ticks — same as the design's Calendar.
  return (
    <svg {...base} {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function RisksIcon(p: IconProps) {
  // Warning triangle with exclamation — explicit "risk" semantics.
  return (
    <svg {...base} {...p}>
      <path d="M10.3 3.9 2.4 17.6a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

export function CustomersIcon(p: IconProps) {
  // Building silhouette with windows — "customer / company".
  return (
    <svg {...base} {...p}>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01" />
      <path d="M10 21v-3h4v3" />
    </svg>
  );
}

export function ProjectsIcon(p: IconProps) {
  // Asymmetric grid of panels — the design system's Projects icon verbatim.
  return (
    <svg {...base} {...p}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function PeopleIcon(p: IconProps) {
  // Two people — the design system's Users icon.
  return (
    <svg {...base} {...p}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </svg>
  );
}

export function CapacityIcon(p: IconProps) {
  // Single person with base curve — the design system's Capacity icon.
  return (
    <svg {...base} {...p}>
      <path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z" />
      <path d="M3 21a9 9 0 0 1 18 0" />
    </svg>
  );
}

export function InsightsIcon(p: IconProps) {
  // Bar chart with rising trend — reads as "analytics / portfolio insight".
  return (
    <svg {...base} {...p}>
      <path d="M3 3v18h18" />
      <rect x="7" y="13" width="3" height="6" rx="0.5" />
      <rect x="12" y="9" width="3" height="10" rx="0.5" />
      <rect x="17" y="5" width="3" height="14" rx="0.5" />
    </svg>
  );
}

export function TrackersIcon(p: IconProps) {
  // Plug / connector — reads as "external integration".
  return (
    <svg {...base} {...p}>
      <path d="M9 2v4M15 2v4" />
      <path d="M7 6h10v6a5 5 0 0 1-10 0V6Z" />
      <path d="M12 17v5" />
    </svg>
  );
}
