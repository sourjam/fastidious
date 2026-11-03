"use client";

import { useEffect, useState } from "react";

import { browserCredentialStore } from "@/lib/identity/credential-store";
import type { FastidiousDatabase } from "@/lib/local-db/database";
import { META_KEY } from "@/lib/local-db/schema";
import { updatePushPreferences, type PushPreferences } from "@/lib/notifications/browser";
import { StatusNotice } from "../ui/StatusNotice";

const DEFAULTS: PushPreferences = {
  enabled: true,
  advanceEnabled: true,
  advanceMinutes: 30,
  goalEnabled: true,
};

export function PushPreferencesCard({ database }: { database?: FastidiousDatabase }) {
  const [available, setAvailable] = useState(false);
  const [preferences, setPreferences] = useState(DEFAULTS);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!database || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.getRegistration()
      .then((registration) => registration?.pushManager.getSubscription())
      .then(async (subscription) => {
        if (!subscription) return;
        const [meta, secret] = await Promise.all([database.meta.get(META_KEY), Promise.resolve(browserCredentialStore.read())]);
        if (!meta || !secret) return;
        const response = await fetch(`/api/push/subscriptions?deviceId=${encodeURIComponent(meta.deviceId)}`, {
          headers: { Authorization: `Bearer ${secret}` },
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = await response.json() as { preferences?: PushPreferences };
        if (body.preferences) setPreferences(body.preferences);
        setAvailable(true);
      })
      .catch(() => setError(true));
  }, [database]);

  if (!available || !database) return null;

  async function save(next: PushPreferences) {
    setPreferences(next);
    setError(false);
    const [meta, secret] = await Promise.all([database!.meta.get(META_KEY), Promise.resolve(browserCredentialStore.read())]);
    if (!meta || !secret || !await updatePushPreferences({ secret, deviceId: meta.deviceId, preferences: next })) setError(true);
  }

  return (
    <section className="settings-card" aria-labelledby="reminder-settings-title">
      <span className="panel-kicker">This device</span>
      <h2 id="reminder-settings-title">Reminders</h2>
      {error ? <StatusNotice tone="error">Reminder preferences could not be saved.</StatusNotice> : null}
      <label className="settings-toggle">
        <input type="checkbox" checked={preferences.enabled} onChange={(event) => void save({ ...preferences, enabled: event.target.checked })} />
        Enable reminders
      </label>
      <label className="settings-toggle">
        <input type="checkbox" checked={preferences.advanceEnabled} disabled={!preferences.enabled} onChange={(event) => void save({ ...preferences, advanceEnabled: event.target.checked })} />
        Remind me before the goal
      </label>
      <label>
        Advance time
        <select value={preferences.advanceMinutes} disabled={!preferences.enabled || !preferences.advanceEnabled} onChange={(event) => void save({ ...preferences, advanceMinutes: Number(event.target.value) as 15 | 30 | 60 })}>
          <option value={15}>15 minutes</option>
          <option value={30}>30 minutes</option>
          <option value={60}>60 minutes</option>
        </select>
      </label>
      <label className="settings-toggle">
        <input type="checkbox" checked={preferences.goalEnabled} disabled={!preferences.enabled} onChange={(event) => void save({ ...preferences, goalEnabled: event.target.checked })} />
        Remind me at goal completion
      </label>
    </section>
  );
}
