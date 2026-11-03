type Segment<T extends string> = {
  value: T;
  label: string;
};

interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <fieldset className="segmented-control">
      <legend className="visually-hidden">{label}</legend>
      {options.map((option) => (
        <label className="segment" key={option.value}>
          <input
            type="radio"
            name={label}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
