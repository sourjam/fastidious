const levels = [
  { bucket: 1, label: "<8" },
  { bucket: 2, label: "8" },
  { bucket: 3, label: "14" },
  { bucket: 4, label: "18" },
  { bucket: 5, label: "22+" },
] as const;

export function HeatLegend({ title = "Hours fasted", proportional = false }: { title?: string; proportional?: boolean }) {
  const shownLevels = proportional
    ? levels.map((level, index) => ({ ...level, label: ["<25%", "25", "50", "75", "100%"][index]! }))
    : levels;
  return (
    <div className="heat-legend" aria-label={`${title} legend`}>
      <span>{title}</span>
      {shownLevels.map((level) => (
        <span className="legend-level" key={level.bucket}>
          <i className={`heat-${level.bucket}`} aria-hidden="true" />{level.label}
        </span>
      ))}
    </div>
  );
}
