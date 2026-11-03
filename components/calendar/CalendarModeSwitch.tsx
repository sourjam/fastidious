import { SegmentedControl } from "../ui/SegmentedControl";

export type CalendarMode = "day" | "month" | "year";

const modes = [
  { value: "day", label: "Day" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
] as const;

export function CalendarModeSwitch({ value, onChange }: { value: CalendarMode; onChange: (mode: CalendarMode) => void }) {
  return <SegmentedControl label="Calendar view" options={modes} value={value} onChange={onChange} />;
}
