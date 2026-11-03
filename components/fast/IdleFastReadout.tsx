"use client";

import { useEffect, useState } from "react";

import { goalLabel, idleFastViewModel } from "@/lib/domain/fast-view";
import type { FastRecord } from "@/lib/domain/types";
import { FastProgress } from "./FastProgress";

export function IdleFastReadout({
  lastFast,
  goalHours,
  timezone,
  onOpenGoal,
  now = Date.now,
}: {
  lastFast?: FastRecord;
  goalHours: number;
  timezone: string;
  onOpenGoal: () => void;
  now?: () => number;
}) {
  const [currentTime, setCurrentTime] = useState(now);
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      if (document.visibilityState === "hidden") return;
      setCurrentTime(now());
      timer = window.setTimeout(schedule, 1_000 - (now() % 1_000));
    };
    const onVisibility = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (document.visibilityState === "visible") schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [now]);
  const view = idleFastViewModel(lastFast, currentTime, timezone, navigator.language);
  return (
    <div className="fast-readout-block">
      <div className="fast-kicker-row">
        <span className="panel-kicker">{view.kicker}</span>
        <button className="goal-button" onClick={onOpenGoal} type="button">{goalLabel(goalHours)} goal</button>
      </div>
      <div className="fast-clock" aria-label={`Elapsed eating time ${view.clock}`}>{view.clock}</div>
      <p className="fast-subline">{view.subline}</p>
      <FastProgress elapsedMs={0} goalHours={goalHours} />
    </div>
  );
}
