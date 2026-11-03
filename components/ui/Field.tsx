import { useId, type InputHTMLAttributes, type ReactNode } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
}

export function Field({ label, error, hint, id, className = "", ...props }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  return (
    <div className={`field ${error ? "field-error" : ""} ${className}`.trim()}>
      <label htmlFor={inputId}>{label}</label>
      <input
        className="input"
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        {...props}
      />
      {error || hint ? (
        <span className="field-message" id={messageId}>
          {error ?? hint}
        </span>
      ) : null}
    </div>
  );
}
