"use client";

import type { ReactNode } from "react";
import { Button } from "./Button";
import { Sheet } from "./Sheet";

interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  isCommitting?: boolean;
}

export function ConfirmationDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onClose,
  isCommitting = false,
}: ConfirmationDialogProps) {
  return (
    <Sheet open={open} title={title} onClose={onClose} isCommitting={isCommitting}>
      <div className="confirmation-body">{children}</div>
      <div className="dialog-actions">
        <Button onClick={onClose} disabled={isCommitting}>{cancelLabel}</Button>
        <Button variant="primary" onClick={onConfirm} disabled={isCommitting}>
          {isCommitting ? "Working…" : confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}
