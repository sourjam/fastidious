import type { ButtonHTMLAttributes, ReactNode } from "react";
import { BlueprintMarks } from "./Blueprint";

type ButtonVariant = "primary" | "secondary" | "ghost" | "icon";
type NativeButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

type ButtonProps =
  | (NativeButtonProps & {
      variant: "icon";
      "aria-label": string;
      children: ReactNode;
    })
  | (NativeButtonProps & {
      variant?: Exclude<ButtonVariant, "icon">;
      children: ReactNode;
    });

export function Button({ variant = "secondary", className = "", children, type = "button", ...props }: ButtonProps) {
  const isPrimary = variant === "primary";
  return (
    <button
      className={`button button-${variant} ${isPrimary ? "blueprint" : ""} ${className}`.trim()}
      type={type}
      {...props}
    >
      {isPrimary ? <BlueprintMarks /> : null}
      {children}
    </button>
  );
}
