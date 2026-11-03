import { Blueprint } from "./Blueprint";

interface InfoCellProps {
  label: string;
  value: string;
  hint?: string;
}

export function InfoCell({ label, value, hint }: InfoCellProps) {
  return (
    <Blueprint className="info-cell">
      <span className="info-cell-label">{label}</span>
      <strong className="info-cell-value">{value}</strong>
      {hint ? <span className="info-cell-hint">{hint}</span> : null}
    </Blueprint>
  );
}
