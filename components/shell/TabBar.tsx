import type { ReactNode } from "react";
import { CalendarIcon, StatsIcon, TimerIcon, TodayIcon, UserIcon } from "./icons";

export type AppTab = "fast" | "today" | "calendar" | "stats" | "you";

const tabs: { id: AppTab; label: string; icon: ReactNode }[] = [
  { id: "fast", label: "Fast", icon: <TimerIcon /> },
  { id: "today", label: "Today", icon: <TodayIcon /> },
  { id: "calendar", label: "Calendar", icon: <CalendarIcon /> },
  { id: "stats", label: "Stats", icon: <StatsIcon /> },
  { id: "you", label: "You", icon: <UserIcon /> },
];

interface TabBarProps {
  selected: AppTab;
  onSelect: (tab: AppTab) => void;
}

export function TabBar({ selected, onSelect }: TabBarProps) {
  return (
    <nav className="tab-bar" aria-label="Primary navigation">
      {tabs.map((tab) => (
        <button
          aria-current={selected === tab.id ? "page" : undefined}
          className="tab-button"
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          type="button"
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
