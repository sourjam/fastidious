"use client";

import { useEffect, useState } from "react";

import type { FastidiousDatabase } from "@/lib/local-db/database";
import { META_KEY } from "@/lib/local-db/schema";
import { browserCredentialStore } from "@/lib/identity/credential-store";
import { enablePushReminders, type PushEnableResult } from "@/lib/notifications/browser";
import { Button } from "../ui/Button";
import { StatusNotice } from "../ui/StatusNotice";

const PROMPT_STATE_KEY = "fastidious.push-prompt";
type PromptState = "available" | "working" | "enabled" | "hidden" | "install-required" | "unsupported" | "error";

export function PushReminderCard({ database, hasFast }: { database: FastidiousDatabase; hasFast: boolean }) {
  const [state, setState] = useState<PromptState>("hidden");

  useEffect(() => {
    if (!hasFast) return;
    const remembered = localStorage.getItem(PROMPT_STATE_KEY);
    setState(remembered === "dismissed" || remembered === "denied" || remembered === "enabled" ? "hidden" : "available");
  }, [hasFast]);

  if (!hasFast || state === "hidden") return null;

  async function enable() {
    setState("working");
    try {
      const [meta, secret] = await Promise.all([database.meta.get(META_KEY), Promise.resolve(browserCredentialStore.read())]);
      if (!meta || !secret) throw new Error("Your log is not ready for reminders.");
      const result = await enablePushReminders({ secret, deviceId: meta.deviceId });
      applyResult(result);
    } catch {
      setState("error");
    }
  }

  function applyResult(result: PushEnableResult) {
    if (result.status === "enabled") {
      localStorage.setItem(PROMPT_STATE_KEY, "enabled");
      setState("enabled");
    } else if (result.status === "denied") {
      localStorage.setItem(PROMPT_STATE_KEY, "denied");
      setState("hidden");
    } else {
      setState(result.status);
    }
  }

  if (state === "install-required") {
    return <StatusNotice tone="info">On iPhone or iPad, use Share → Add to Home Screen, then open Fastidious there to enable reminders.</StatusNotice>;
  }
  if (state === "unsupported") {
    return <StatusNotice tone="info">This browser does not support installed Web Push reminders.</StatusNotice>;
  }
  if (state === "error") {
    return <StatusNotice tone="error">Reminders could not be enabled. Your fast is still saved.</StatusNotice>;
  }
  if (state === "enabled") {
    return <StatusNotice tone="status">Reminders are enabled for this device.</StatusNotice>;
  }

  return (
    <aside className="push-reminder-card" aria-label="Fast reminders">
      <span className="panel-kicker">Around your goal</span>
      <strong>Get fasting reminders?</strong>
      <p>Fastidious can notify this device before your goal and when it is complete. Starts made fully offline can only be scheduled after they sync.</p>
      <div className="push-reminder-actions">
        <Button variant="primary" disabled={state === "working"} onClick={() => void enable()}>
          {state === "working" ? "Enabling…" : "Remind me"}
        </Button>
        <Button onClick={() => {
          localStorage.setItem(PROMPT_STATE_KEY, "dismissed");
          setState("hidden");
        }}>No thanks</Button>
      </div>
    </aside>
  );
}
