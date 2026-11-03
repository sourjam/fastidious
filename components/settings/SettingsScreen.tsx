"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";

import type { EpochMs, LogPreferences, ThemePreference, WeightUnit } from "@/lib/domain/types";
import { openLocalDatabase, type FastidiousDatabase } from "@/lib/local-db/database";
import { usePreferences } from "@/lib/local-db/hooks";
import { clearData, replaceFromImport, restorePreImportBackup, updatePreferences } from "@/lib/local-db/operations";
import { BACKUP_KEY, META_KEY } from "@/lib/local-db/schema";
import { buildExport, exportFilename, MAX_IMPORT_BYTES, parseImport, type ImportPreview } from "@/lib/settings/data";
import { PushPreferencesCard } from "../notifications/PushPreferencesCard";
import { NutritionTargetsCard } from "./NutritionTargetsCard";
import { Blueprint } from "../ui/Blueprint";
import { Button } from "../ui/Button";
import { ConfirmationDialog } from "../ui/ConfirmationDialog";
import { Field } from "../ui/Field";
import { SegmentedControl } from "../ui/SegmentedControl";
import { StatusNotice } from "../ui/StatusNotice";

const themeOptions = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;
const weightOptions = [
  { value: "kg", label: "kg" },
  { value: "lb", label: "lb" },
] as const;

type Dialog = "import" | "clear" | "rotate" | "remove" | null;

export function SettingsScreen({ database, accessLink, onRotate, onRemove, onLocalChange, onThemeChange, now = Date.now }: {
  database?: FastidiousDatabase;
  accessLink?: string;
  onRotate?: () => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  onLocalChange?: () => void;
  onThemeChange?: (theme: ThemePreference) => void;
  now?: () => number;
}) {
  const [ownedDatabase, setOwnedDatabase] = useState<FastidiousDatabase>();
  const db = database ?? ownedDatabase;
  useEffect(() => {
    if (database) return;
    let active = true;
    let opened: FastidiousDatabase | undefined;
    void openLocalDatabase().then((value) => {
      opened = value;
      if (active) setOwnedDatabase(value);
      else value.close();
    });
    return () => { active = false; opened?.close(); };
  }, [database]);
  if (!db) return <section className="shell-panel" aria-label="You"><h1 className="visually-hidden">You</h1><span className="panel-kicker">Loading settings</span></section>;
  return <SettingsContent database={db} accessLink={accessLink} onRotate={onRotate} onRemove={onRemove} onLocalChange={onLocalChange} onThemeChange={onThemeChange} now={now} />;
}

function SettingsContent({ database, accessLink, onRotate, onRemove, onLocalChange, onThemeChange, now }: {
  database: FastidiousDatabase;
  accessLink?: string;
  onRotate?: () => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  onLocalChange?: () => void;
  onThemeChange?: (theme: ThemePreference) => void;
  now: () => number;
}) {
  const preferences = usePreferences(database);
  const summary = useLiveQuery(async () => {
    const [fasts, weights, backup, pendingReset, pendingImages] = await Promise.all([
      database.fasts.filter((record) => record.deletedAt === null).count(),
      database.weights.filter((record) => record.deletedAt === null).count(),
      database.preImportBackup.get(BACKUP_KEY),
      database.mutations.filter((mutation) => mutation.entityType === "log" && (mutation.operation === "replace" || mutation.operation === "clear")).count(),
      database.pendingImages.count(),
    ]);
    return { fasts, weights, hasBackup: Boolean(backup), pendingReset: pendingReset > 0, pendingImages };
  }, [database]);
  const [copied, setCopied] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [preview, setPreview] = useState<ImportPreview>();
  const [error, setError] = useState<string>();
  const [timezone, setTimezone] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!preferences) return;
    setTimezone(preferences.timezone);
    onThemeChange?.(preferences.theme);
  }, [onThemeChange, preferences]);
  if (!preferences || !summary) return <section className="shell-panel" aria-label="You"><h1 className="visually-hidden">You</h1><span className="panel-kicker">Loading settings</span></section>;

  async function savePreferences(next: LogPreferences) {
    const result = await updatePreferences(database, { preferences: next, now: now() as EpochMs });
    if (!result.ok) { setError(result.message); return false; }
    setError(undefined);
    onLocalChange?.();
    return true;
  }

  async function copyLink() {
    if (!accessLink) return;
    await navigator.clipboard.writeText(accessLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  async function downloadExport() {
    const exportedAt = new Date(now());
    const blob = new Blob([JSON.stringify(await buildExport(database, exportedAt), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportFilename(exportedAt);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function selectImport(file?: File) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { setError("Import files must be 5 MB or smaller."); return; }
    const meta = await database.meta.get(META_KEY);
    if (!meta?.logId) { setError("No active log is installed on this device."); return; }
    const parsed = parseImport(await file.text(), meta.logId, now());
    if (!parsed.ok) { setError(parsed.message); return; }
    setError(undefined);
    setPreview(parsed.value);
    setDialog("import");
  }

  async function applyImport() {
    if (!preview) return;
    setBusy(true);
    const result = await replaceFromImport(database, { snapshot: preview.snapshot, now: now() as EpochMs });
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    setPreview(undefined);
    setDialog(null);
    onThemeChange?.(preview.preferences.theme);
    onLocalChange?.();
  }

  async function clearAll() {
    setBusy(true);
    const result = await clearData(database, { now: now() as EpochMs });
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    setDialog(null);
    onLocalChange?.();
  }

  async function recoverBackup() {
    const result = await restorePreImportBackup(database, { now: now() as EpochMs });
    if (!result.ok) { setError(result.message); return; }
    onThemeChange?.(result.value.value.preferences.theme);
    onLocalChange?.();
  }

  return (
    <section className="shell-panel settings-screen" aria-label="You">
      <h1 className="visually-hidden">You</h1>
      <span className="panel-kicker">You</span>
      {error ? <StatusNotice tone="error">{error}</StatusNotice> : null}
      {summary.pendingReset ? <StatusNotice>Replacement is saved locally and awaiting synchronization.</StatusNotice> : null}
      {accessLink ? <Blueprint className="settings-card access-card">
        <h2>Your link</h2>
        <p>There is no login. Anyone with this link can view, edit, or delete your fasting log. Treat it like a password.</p>
        <code>{accessLink}</code>
        <div className="settings-actions">
          <Button onClick={() => void copyLink()}>{copied ? "Copied" : "Copy link"}</Button>
          <Button onClick={() => setDialog("rotate")}>Rotate link</Button>
        </div>
      </Blueprint> : null}

      <Blueprint className="settings-card">
        <h2>Preferences</h2>
        <label className="settings-label">Appearance</label>
        <SegmentedControl label="Appearance" options={themeOptions} value={preferences.theme} onChange={(theme) => void savePreferences({ ...preferences, theme }).then((saved) => { if (saved) onThemeChange?.(theme); })} />
        <label className="settings-label">Weight unit</label>
        <SegmentedControl label="Weight unit" options={weightOptions} value={preferences.weightUnit} onChange={(weightUnit: WeightUnit) => void savePreferences({ ...preferences, weightUnit })} />
        <Field label="Timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} onBlur={() => { if (timezone !== preferences.timezone) void savePreferences({ ...preferences, timezone: timezone as LogPreferences["timezone"] }); }} list="timezones" hint="Use an IANA timezone, such as America/New_York." />
        <datalist id="timezones">{supportedTimezones().map((zone) => <option key={zone} value={zone} />)}</datalist>
      </Blueprint>

      <NutritionTargetsCard database={database} now={now} onLocalChange={onLocalChange} />

      <PushPreferencesCard database={database} />

      <Blueprint className="settings-card">
        <h2>Your data</h2>
        <p>{summary.fasts} {summary.fasts === 1 ? "fast" : "fasts"} · {summary.weights} {summary.weights === 1 ? "weight" : "weights"}</p>
        <p className="settings-note">JSON exports include image references, not image files.{summary.pendingImages > 0 ? ` ${summary.pendingImages} pending image${summary.pendingImages === 1 ? " remains" : "s remain"} only on this device.` : ""}</p>
        <div className="settings-actions">
          <Button onClick={() => void downloadExport()}>Export JSON</Button>
          <Button onClick={() => fileInput.current?.click()}>Import JSON</Button>
          {summary.hasBackup ? <Button onClick={() => void recoverBackup()}>Recover pre-import data</Button> : null}
          <Button className="danger-action" onClick={() => setDialog("clear")}>Clear all data</Button>
        </div>
        <input ref={fileInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void selectImport(event.target.files?.[0])} />
      </Blueprint>

      <Blueprint className="settings-card">
        <h2>This device</h2>
        <p>Removing this log only erases it from this device. It does not delete the server log.</p>
        <Button className="danger-action" onClick={() => setDialog("remove")}>Remove from this device</Button>
      </Blueprint>

      <Blueprint className="settings-card">
        <h2>About</h2>
        <nav className="settings-links" aria-label="Information">
          <a href="/privacy">Privacy</a>
          <a href="/help">Help &amp; about</a>
        </nav>
      </Blueprint>

      <ConfirmationDialog open={dialog === "import"} title="Replace current data?" confirmLabel="Replace data" onConfirm={() => void applyImport()} onClose={() => setDialog(null)} isCommitting={busy}>
        {preview ? <p>Current data will be replaced, but your access link remains. Import {preview.fastCount} fasts and {preview.weightCount} weights{preview.hasActiveFast ? ", including an active fast" : ""}. {preview.droppedImageCount > 0 ? ` ${preview.droppedImageCount} image reference${preview.droppedImageCount === 1 ? " will" : "s will"} be removed.` : ""} Date range: {formatRange(preview)}. Preferences: {preview.timezone}, {preview.preferences.theme} appearance, {preview.preferences.weightUnit}, {preview.preferences.defaultGoalHours}-hour default goal.</p> : null}
      </ConfirmationDialog>
      <ConfirmationDialog open={dialog === "clear"} title="Clear all fasting data?" confirmLabel="Clear all data" onConfirm={() => void clearAll()} onClose={() => setDialog(null)} isCommitting={busy}>
        Your access link and preferences will remain. Every fast and weight will be permanently removed from all connected devices.
      </ConfirmationDialog>
      <ConfirmationDialog open={dialog === "rotate"} title="Rotate access link?" confirmLabel="Rotate link" onConfirm={() => { setDialog(null); void onRotate?.(); }} onClose={() => setDialog(null)}>
        Old bookmarks stop working. Old devices lose access and erase cached Fastidious data when they reconnect. Offline devices cannot be remotely erased before reconnecting.
      </ConfirmationDialog>
      <ConfirmationDialog open={dialog === "remove"} title="Remove from this device?" confirmLabel="Remove from device" onConfirm={() => { setDialog(null); void onRemove?.(); }} onClose={() => setDialog(null)}>
        This erases local data and the saved link from this device. It does not delete the server log or data on other devices.
      </ConfirmationDialog>
    </section>
  );
}

function supportedTimezones(): string[] {
  try { return Intl.supportedValuesOf("timeZone"); } catch { return []; }
}

function formatRange(preview: ImportPreview): string {
  if (preview.firstDate === null || preview.lastDate === null) return "no dated records";
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: preview.timezone });
  return `${formatter.format(preview.firstDate)}–${formatter.format(preview.lastDate)}`;
}
