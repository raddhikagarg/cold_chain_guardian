/**
 * Minimal inline SVG icon set (stroke-based, 24x24 viewBox).
 * Kept in one file so components stay readable and we avoid adding icon libraries.
 */

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function SnowflakeIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <path d="M12 2v20M4.2 6.5l15.6 11M19.8 6.5L4.2 17.5M12 6l2.5-2.5M12 6L9.5 3.5M12 18l2.5 2.5M12 18l-2.5 2.5M7.2 9.2 4 8.5M7.2 9.2l.7-3.2M16.8 14.8l3.2.7M16.8 14.8l-.7 3.2M7.2 14.8 4 15.5M7.2 14.8l.7 3.2M16.8 9.2l3.2-.7M16.8 9.2l-.7-3.2" />
    </svg>
  )
}

export function ThermometerIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <path d="M10 4a2 2 0 1 1 4 0v9.3a4.5 4.5 0 1 1-4 0Z" />
      <circle cx="12" cy="17.5" r="1.8" fill="currentColor" stroke="none" />
      <path d="M12 15.5V7.5" />
    </svg>
  )
}

export function DropletIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <path d="M12 3s6.5 6.6 6.5 11a6.5 6.5 0 0 1-13 0C5.5 9.6 12 3 12 3Z" />
    </svg>
  )
}

export function BellIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9Z" />
      <path d="M10 19a2.2 2.2 0 0 0 4 0" />
    </svg>
  )
}

export function TruckIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <path d="M2 6h12v10H2zM14 9h4l3 3.5V16h-7" />
      <circle cx="6.5" cy="17.5" r="1.6" />
      <circle cx="17" cy="17.5" r="1.6" />
    </svg>
  )
}

export function ClockIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </svg>
  )
}

export function CpuIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="10" y="10" width="4" height="4" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </svg>
  )
}

export function DoorIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3.5 21h17" />
      <circle cx="14.7" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function ShockIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <path d="M13 2 5 13.5h5.5L9.5 22l8-11.5H12L13 2Z" />
    </svg>
  )
}

export function BatteryIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <rect x="2" y="8" width="17" height="9" rx="2" />
      <path d="M22 11v3" strokeWidth={2.4} />
      <rect x="4.5" y="10.5" width="7" height="4" fill="currentColor" stroke="none" rx="0.6" />
    </svg>
  )
}

export function PlusIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function SearchIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4 4" />
    </svg>
  )
}

export function ArrowLeftIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  )
}

export function ChevronRightIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <path d="m9 5 7 7-7 7" />
    </svg>
  )
}

export function SunIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  )
}

export function WindIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <path d="M3 8h10a3 3 0 1 0-3-3M3 12h14a3 3 0 1 1-3 3M3 16h7a2.5 2.5 0 1 1-2.5 2.5" />
    </svg>
  )
}

export function LeafIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <path d="M20 4C9 4 4 9 4 16a4 4 0 0 0 4 4c7 0 12-5 12-16Z" />
      <path d="M4 20c2-8 7-11 13-13" />
    </svg>
  )
}

export function WifiIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <path d="M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10 10 0 0 1 13 0M8.5 16a5.5 5.5 0 0 1 7 0" />
      <circle cx="12" cy="19.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function AlertTriangleIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <path d="M12 3 2.7 19.2a1.2 1.2 0 0 0 1 1.8h16.6a1.2 1.2 0 0 0 1-1.8L12 3Z" />
      <path d="M12 9v5M12 17.3v.01" />
    </svg>
  )
}

export function BoxIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </svg>
  )
}

export function MapPinIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  )
}

export function InfoIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5v.01" />
    </svg>
  )
}

export function CheckIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.8-5.5" />
    </svg>
  )
}
