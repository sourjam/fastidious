import type { ReactNode } from "react";

type NoticeTone = "info" | "error" | "status";

interface StatusNoticeProps {
  children: ReactNode;
  tone?: NoticeTone;
}

export function StatusNotice({ children, tone = "info" }: StatusNoticeProps) {
  return (
    <div className={`status-notice status-notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}
