import type { HTMLAttributes, ReactNode } from "react";

export function BlueprintMarks() {
  return (
    <span className="blueprint-marks" aria-hidden="true">
      <i className="corner corner-tl" />
      <i className="corner corner-tr" />
      <i className="corner corner-bl" />
      <i className="corner corner-br" />
    </span>
  );
}

interface BlueprintProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Blueprint({ children, className = "", ...props }: BlueprintProps) {
  return (
    <div className={`blueprint ${className}`.trim()} {...props}>
      <BlueprintMarks />
      {children}
    </div>
  );
}
