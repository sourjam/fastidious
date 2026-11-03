import type { HTMLAttributes, ReactNode } from "react";

type TagVariant = "outline" | "accent" | "status";

interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: TagVariant;
  children: ReactNode;
}

export function Tag({ variant = "outline", className = "", children, ...props }: TagProps) {
  return (
    <span className={`tag tag-${variant} ${className}`.trim()} {...props}>
      {children}
    </span>
  );
}
