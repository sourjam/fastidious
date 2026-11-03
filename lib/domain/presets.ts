import type { FastPreset } from "./types";

export const FAST_PRESETS: readonly FastPreset[] = [
  { hours: 13, label: "13h", subtitle: "Circadian" },
  { hours: 16, label: "16:8", subtitle: "Lean" },
  { hours: 18, label: "18:6", subtitle: "Steady" },
  { hours: 20, label: "20:4", subtitle: "Warrior" },
  { hours: 23, label: "OMAD", subtitle: "23:1" },
  { hours: 36, label: "36h", subtitle: "Monk" },
  { hours: 48, label: "48h", subtitle: "Two-day" },
  { hours: 72, label: "72h", subtitle: "Three-day" },
];
