import { BlueprintMarks } from "../ui/Blueprint";

interface FastInfoCell {
  label: string;
  value: string;
  hint: string;
  onClick?: () => void;
}

export function FastInfoCells({ cells }: { cells: [FastInfoCell, FastInfoCell] }) {
  return (
    <div className="info-grid">
      {cells.map((cell) => (
        <button className="blueprint fast-info-cell" key={cell.label} onClick={cell.onClick} disabled={!cell.onClick} type="button">
          <BlueprintMarks />
          <span className="info-cell-label">{cell.label}</span>
          <strong className="info-cell-value">{cell.value}</strong>
          <span className="info-cell-hint">{cell.hint}</span>
        </button>
      ))}
    </div>
  );
}
