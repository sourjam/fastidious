import type { SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="22"
      viewBox="0 0 24 24"
      width="22"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      {...props}
    >
      {children}
    </svg>
  );
}

export function TimerIcon() {
  return <Icon><line x1="10" x2="14" y1="2" y2="2" /><line x1="12" x2="15" y1="14" y2="11" /><circle cx="12" cy="14" r="8" /></Icon>;
}

export function TodayIcon() {
  return <Icon><path d="M4 5h16M4 12h10M4 19h7" /><circle cx="19" cy="16" r="3" /></Icon>;
}

export function CalendarIcon() {
  return <Icon><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Icon>;
}

export function StatsIcon() {
  return <Icon><path d="M3 3v18h18" /><path d="M18 17V9M13 17V5M8 17v-3" /></Icon>;
}

export function UserIcon() {
  return <Icon><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></Icon>;
}
