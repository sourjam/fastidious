"use client";

import { useEffect, useRef } from "react";
import { Button } from "./Button";

interface ToastProps {
  message: string;
  onDismiss?: () => void;
  duration?: number;
}

export function Toast({ message, onDismiss, duration = 5000 }: ToastProps) {
  useEffect(() => {
    if (!onDismiss) return;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}

interface UndoToastProps extends ToastProps {
  onUndo: () => void;
  onDismiss: () => void;
}

export function UndoToast({ message, onUndo, onDismiss, duration = 5000 }: UndoToastProps) {
  const undone = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <div className="toast toast-undo" role="status">
      <span>{message}</span>
      <Button
        variant="ghost"
        onClick={() => {
          if (undone.current) return;
          undone.current = true;
          onUndo();
        }}
      >
        Undo
      </Button>
    </div>
  );
}
