"use client";

import { useState } from "react";
import type { PreparedImage } from "../../lib/images/browser";
import { groceryItemDetails } from "../../lib/domain/daily-log";
import type { EpochMs, FoodRecord, GroceryItemId, GroceryItemRecord } from "../../lib/domain/types";
import type { FastidiousDatabase } from "../../lib/local-db/database";
import { clearCompletedGroceryItems, deleteDailyLogRecord, discardPendingImages, saveDailyLogRecord, saveRecordWithPendingImage } from "../../lib/local-db/operations";
import { Button } from "../ui/Button";
import { ConfirmationDialog } from "../ui/ConfirmationDialog";
import { Field } from "../ui/Field";
import { Sheet } from "../ui/Sheet";
import { ImageField } from "./ImageField";
import { PrivateImage } from "./PrivateImage";

interface GrocerySectionProps {
  database: FastidiousDatabase;
  foods: readonly FoodRecord[];
  items: readonly GroceryItemRecord[];
  now: () => number;
  onChanged: () => void;
}

export function GrocerySection({ database, foods, items, now, onChanged }: GrocerySectionProps) {
  const [name, setName] = useState("");
  const [showCart, setShowCart] = useState(false);
  const [editing, setEditing] = useState<GroceryItemRecord>();
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string>();
  const active = items.filter((item) => item.deletedAt === null);
  const toBuy = active.filter((item) => !item.inCart);
  const inCart = active.filter((item) => item.inCart);
  const estimatedCents = toBuy.reduce((sum, item) => sum + (groceryItemDetails(item, foods).priceCents ?? 0), 0);
  const visible = showCart ? active : toBuy;

  async function save(item: GroceryItemRecord, image?: PreparedImage | null) {
    const timestamp = now() as EpochMs;
    const next = { ...item, imageAssetId: image === null ? null : item.imageAssetId, updatedAt: timestamp };
    const result = image
      ? await saveRecordWithPendingImage(database, "groceryItem", next, image, timestamp)
      : await saveDailyLogRecord(database, "groceryItem", next, timestamp);
    if (!result.ok) setError(result.message);
    else { if (image === null) await discardPendingImages(database, "groceryItem", next.id); setError(undefined); onChanged(); }
    return result.ok;
  }

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const meta = await database.meta.get("state");
    if (!meta?.logId) return;
    const timestamp = now() as EpochMs;
    const ok = await save({
      id: crypto.randomUUID() as GroceryItemId,
      logId: meta.logId,
      foodId: null,
      name: trimmed,
      inCart: false,
      externalUrl: null,
      imageAssetId: null,
      revision: 0,
      updatedAt: timestamp,
      deletedAt: null,
    });
    if (ok) setName("");
  }

  async function remove(item: GroceryItemRecord) {
    const result = await deleteDailyLogRecord(database, "groceryItem", item.id, now() as EpochMs);
    if (!result.ok) setError(result.message);
    else { setError(undefined); setEditing(undefined); onChanged(); }
  }

  async function clearCart() {
    const result = await clearCompletedGroceryItems(database, now() as EpochMs);
    if (!result.ok) setError(result.message);
    else { setError(undefined); setConfirmClear(false); onChanged(); }
  }

  return <section className="grocery-card blueprint" aria-labelledby="grocery-heading">
    <header className="grocery-header">
      <div>
        <h2 id="grocery-heading">Grocery list</h2>
        <p>{toBuy.length} to buy{estimatedCents > 0 ? ` · est. $${(estimatedCents / 100).toFixed(2)}` : ""}</p>
      </div>
      {inCart.length > 0 && <div className="grocery-actions">
        <Button variant="ghost" onClick={() => setShowCart((value) => !value)}>{showCart ? "Hide cart" : `Show cart (${inCart.length})`}</Button>
        <Button variant="ghost" onClick={() => setConfirmClear(true)}>Clear cart</Button>
      </div>}
    </header>
    <form className="grocery-add" onSubmit={(event) => { event.preventDefault(); void add(); }}>
      <Field label="Add grocery item" value={name} onChange={(event) => setName(event.target.value)} placeholder="Add item" />
      <Button type="submit" variant="secondary" disabled={!name.trim()}>Add grocery item</Button>
    </form>
    {error && <p role="alert" className="form-error">{error}</p>}
    {visible.length === 0 ? <p className="meal-empty">{inCart.length > 0 ? "Everything is in the cart." : "No groceries to buy."}</p> : <ul className="grocery-list">
      {visible.map((item) => {
        const details = groceryItemDetails(item, foods);
        return <li key={item.id} className={item.inCart ? "is-complete" : undefined}>
          <label>
            <input type="checkbox" checked={item.inCart} onChange={() => void save({ ...item, inCart: !item.inCart })} />
            <span>{details.imageAssetId ? <PrivateImage className="entity-thumbnail" assetId={details.imageAssetId} variant="thumbnail" alt="" /> : null}<strong>{details.name}</strong>{details.priceCents !== null && <small>${(details.priceCents / 100).toFixed(2)}</small>}{item.inCart && <small>In cart</small>}</span>
          </label>
          {details.externalUrl && <a href={details.externalUrl} target="_blank" rel="noreferrer">Link</a>}
          <Button variant="ghost" onClick={() => setEditing(item)}>Edit</Button>
        </li>;
      })}
    </ul>}
    {editing && <GroceryEditor item={editing} onCancel={() => setEditing(undefined)} onSave={async (item, image) => { if (await save(item, image)) setEditing(undefined); }} onDelete={() => void remove(editing)} />}
    <ConfirmationDialog open={confirmClear} title="Clear cart?" confirmLabel={`Clear ${inCart.length} ${inCart.length === 1 ? "item" : "items"}`} onConfirm={() => void clearCart()} onClose={() => setConfirmClear(false)}>
      Remove {inCart.length} completed {inCart.length === 1 ? "item" : "items"}? Items still to buy will remain.
    </ConfirmationDialog>
  </section>;
}

function GroceryEditor({ item, onSave, onDelete, onCancel }: { item: GroceryItemRecord; onSave: (item: GroceryItemRecord, image?: PreparedImage | null) => void; onDelete: () => void; onCancel: () => void }) {
  const [name, setName] = useState(item.name);
  const [url, setUrl] = useState(item.externalUrl ?? "");
  const [error, setError] = useState<string>();
  const [image, setImage] = useState<PreparedImage | null>();
  function submit() {
    const checkedUrl = externalUrl(url);
    if (checkedUrl === undefined) { setError("Link must use http or https."); return; }
    if (!name.trim()) { setError("Name is required."); return; }
    onSave({ ...item, name: name.trim(), externalUrl: checkedUrl }, image);
  }
  return <Sheet open title="Edit grocery item" onClose={onCancel}>
    <Field label="Name" value={name} onChange={(event) => setName(event.target.value)} />
    <Field label="Link URL" hint="Optional http or https link" value={url} onChange={(event) => setUrl(event.target.value)} />
    <ImageField assetId={item.imageAssetId} value={image} onChange={setImage} />
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="sheet-actions">
      <Button onClick={submit}>Save item</Button>
      <Button variant="ghost" onClick={onDelete}>Delete</Button>
      <Button variant="secondary" onClick={onCancel}>Cancel</Button>
    </div>
  </Sheet>;
}

function externalUrl(value: string): string | null | undefined {
  if (!value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
