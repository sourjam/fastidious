"use client";

import { useEffect, useState } from "react";

import type { ChecklistCadence, ChecklistItemId, ChecklistItemRecord, EpochMs } from "@/lib/domain/types";
import type { FastidiousDatabase } from "@/lib/local-db/database";
import { discardPendingImages, saveDailyLogRecord, saveRecordWithPendingImage } from "@/lib/local-db/operations";
import type { PreparedImage } from "@/lib/images/browser";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Sheet } from "../ui/Sheet";
import { ImageField } from "./ImageField";

export function ChecklistManagerSheet({
  open,
  items,
  onAdd,
  onEdit,
  onClose,
}: {
  open: boolean;
  items: readonly ChecklistItemRecord[];
  onAdd: () => void;
  onEdit: (item: ChecklistItemRecord) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} title="Edit checklist" onClose={onClose}>
      {items.length === 0 ? <p className="checklist-sheet-empty">No checklist items yet.</p> : (
        <ul className="checklist-management-list">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <span>{cadenceLabel(item.cadence)}</span>
              </div>
              <Button onClick={() => onEdit(item)}>Edit {item.name}</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="dialog-actions">
        <Button onClick={onClose}>Done</Button>
        <Button variant="primary" onClick={onAdd}>Add item</Button>
      </div>
    </Sheet>
  );
}

export function ChecklistItemSheet({
  open,
  item,
  database,
  now,
  onSaved,
  onDelete,
  onClose,
}: {
  open: boolean;
  item: ChecklistItemRecord | null;
  database: FastidiousDatabase;
  now: () => number;
  onSaved: () => void;
  onDelete: (item: ChecklistItemRecord) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [cadence, setCadence] = useState<ChecklistCadence>("daily");
  const [externalUrl, setExternalUrl] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [image, setImage] = useState<PreparedImage | null>();

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? "");
    setCadence(item?.cadence ?? "daily");
    setExternalUrl(item?.externalUrl ?? "");
    setImage(undefined);
    setError(undefined);
  }, [item, open]);

  async function save() {
    const meta = await database.meta.get("state");
    if (!meta?.logId) {
      setError("No active log is available.");
      return;
    }
    const timestamp = now() as EpochMs;
    const next: ChecklistItemRecord = {
      id: item?.id ?? crypto.randomUUID() as ChecklistItemId,
      logId: meta.logId,
      name,
      cadence,
      externalUrl: externalUrl.trim() || null,
      imageAssetId: image === null ? null : item?.imageAssetId ?? null,
      sortOrder: item?.sortOrder ?? await database.checklistItems.count(),
      revision: item?.revision ?? 0,
      updatedAt: timestamp,
      deletedAt: null,
    };
    setSaving(true);
    try {
      const result = image
        ? await saveRecordWithPendingImage(database, "checklistItem", next, image, timestamp)
        : await saveDailyLogRecord(database, "checklistItem", next, timestamp);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (image === null) await discardPendingImages(database, "checklistItem", next.id);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} title={item ? "Edit checklist item" : "Add checklist item"} onClose={onClose} isCommitting={saving}>
      <Field label="Name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} error={error} />
      <label className="field">
        <span>Cadence</span>
        <select className="input" aria-label="Cadence" value={cadence} onChange={(event) => setCadence(event.target.value as ChecklistCadence)}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>
      <Field
        label="Link URL"
        value={externalUrl}
        onChange={(event) => setExternalUrl(event.target.value)}
        inputMode="url"
        maxLength={2_048}
        hint="Optional http or https link"
      />
      <ImageField assetId={item?.imageAssetId ?? null} value={image} onChange={setImage} />
      <div className="dialog-actions checklist-editor-actions">
        {item ? <Button className="danger-action" onClick={() => onDelete(item)} disabled={saving}>Delete item</Button> : null}
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={saving || name.trim().length === 0}>
          {saving ? "Saving…" : "Save item"}
        </Button>
      </div>
    </Sheet>
  );
}

export function cadenceLabel(cadence: ChecklistCadence): string {
  return cadence[0]!.toUpperCase() + cadence.slice(1);
}
