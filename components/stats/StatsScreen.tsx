"use client";

import { useEffect, useMemo, useState } from "react";

import { completedFastStatistics, lastCompletedFasts, streakStatistics } from "@/lib/domain/statistics";
import type { EpochMs, WeightId } from "@/lib/domain/types";
import { openLocalDatabase, type FastidiousDatabase } from "@/lib/local-db/database";
import { useCompletedFasts, usePreferences, useWeights } from "@/lib/local-db/hooks";
import { addWeight, deleteWeight, restoreWeight } from "@/lib/local-db/operations";
import { StatusNotice } from "../ui/StatusNotice";
import { UndoToast } from "../ui/Toast";
import { AddWeightSheet } from "./AddWeightSheet";
import { RecentFastsChart } from "./RecentFastsChart";
import { StatGrid } from "./StatGrid";
import { WeightCard } from "./WeightCard";

export function StatsScreen({ database, onLocalChange, now = Date.now, locale }: {
  database?: FastidiousDatabase;
  onLocalChange?: () => void;
  now?: () => number;
  locale?: string;
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
    return () => {
      active = false;
      opened?.close();
    };
  }, [database]);

  if (!db) {
    return <section className="shell-panel" aria-label="Stats"><h1 className="visually-hidden">Stats</h1><span className="panel-kicker">Loading statistics</span></section>;
  }

  return <StatsContent database={db} onLocalChange={onLocalChange} now={now} locale={locale} />;
}

function StatsContent({ database, onLocalChange, now, locale }: {
  database: FastidiousDatabase;
  onLocalChange?: () => void;
  now: () => number;
  locale?: string;
}) {
  const fasts = useCompletedFasts(database);
  const weights = useWeights(database);
  const preferences = usePreferences(database);
  const [addOpen, setAddOpen] = useState(false);
  const [undo, setUndo] = useState<WeightId>();
  const [error, setError] = useState<string>();
  const resolvedLocale = locale ?? (typeof navigator === "undefined" ? "en-US" : navigator.language);
  const current = now();
  const values = useMemo(() => {
    if (!fasts || !preferences) return undefined;
    return {
      summary: completedFastStatistics(fasts),
      streak: streakStatistics(fasts, preferences.timezone, current),
      recent: lastCompletedFasts(fasts),
    };
  }, [current, fasts, preferences]);

  if (!fasts || !weights || !preferences || !values) {
    return <section className="shell-panel" aria-label="Stats"><h1 className="visually-hidden">Stats</h1><span className="panel-kicker">Loading statistics</span></section>;
  }

  function changed() {
    setError(undefined);
    onLocalChange?.();
  }

  async function saveWeight(kilograms: number): Promise<string | undefined> {
    const timestamp = now() as EpochMs;
    const result = await addWeight(database, { measuredAt: timestamp, kilograms, now: timestamp });
    if (!result.ok) return result.message;
    changed();
    setAddOpen(false);
    return undefined;
  }

  async function removeWeight(id: WeightId) {
    const result = await deleteWeight(database, { id, now: now() as EpochMs });
    if (!result.ok) return setError(result.message);
    changed();
    setUndo(id);
  }

  async function restoreDeleted() {
    if (!undo) return;
    const result = await restoreWeight(database, { id: undo, now: now() as EpochMs });
    if (!result.ok) setError(result.message);
    else changed();
    setUndo(undefined);
  }

  return (
    <section className="shell-panel stats-screen" aria-label="Stats">
      <h1 className="visually-hidden">Stats</h1>
      {error ? <StatusNotice tone="error">{error}</StatusNotice> : null}
      <StatGrid summary={values.summary} streak={values.streak} locale={resolvedLocale} />
      <RecentFastsChart fasts={values.recent} locale={resolvedLocale} timezone={preferences.timezone} />
      <WeightCard
        weights={weights}
        unit={preferences.weightUnit}
        locale={resolvedLocale}
        timezone={preferences.timezone}
        now={current}
        onAdd={() => setAddOpen(true)}
        onDelete={(id) => void removeWeight(id)}
      />
      <AddWeightSheet open={addOpen} unit={preferences.weightUnit} onClose={() => setAddOpen(false)} onSave={saveWeight} />
      {undo ? <UndoToast message="Weight deleted." onUndo={() => void restoreDeleted()} onDismiss={() => setUndo(undefined)} /> : null}
    </section>
  );
}
