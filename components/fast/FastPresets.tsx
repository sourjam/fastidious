import { FAST_PRESETS } from "@/lib/domain/presets";

export function FastPresets({ selected, onSelect }: { selected: number; onSelect: (hours: number) => void }) {
  return (
    <div className="fast-presets" role="group" aria-label="Fast length presets">
      {FAST_PRESETS.map((preset) => (
        <button
          className="fast-preset"
          aria-label={`${preset.label} ${preset.subtitle}`}
          aria-pressed={preset.hours === selected}
          key={preset.hours}
          onClick={() => onSelect(preset.hours)}
          type="button"
        >
          <strong>{preset.label}</strong>
          <span>{preset.subtitle}</span>
        </button>
      ))}
    </div>
  );
}
