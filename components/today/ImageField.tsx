"use client";

import { useEffect, useState } from "react";

import { prepareImage, type PreparedImage } from "@/lib/images/browser";
import { PrivateImage } from "./PrivateImage";

export function ImageField({ assetId, value, onChange }: { assetId: string | null; value: PreparedImage | null | undefined; onChange(value: PreparedImage | null): void }) {
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (!value) { setPreview(undefined); return; }
    const reader = new FileReader();
    reader.addEventListener("load", () => setPreview(typeof reader.result === "string" ? reader.result : undefined));
    reader.readAsDataURL(value.blob);
    return () => reader.abort();
  }, [value]);
  const visibleAssetId = value === null ? null : assetId;
  return (
    <div className="image-field">
      {preview ? <img src={preview} alt="Selected preview" /> : visibleAssetId ? <PrivateImage assetId={visibleAssetId} variant="preview" alt="Current image" /> : null}
      <label className="field">
        <span>Image <small>optional · JPEG, PNG, or WebP · 5 MB max</small></span>
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          try { onChange(await prepareImage(file)); setError(undefined); }
          catch (cause) { setError(cause instanceof Error ? cause.message : "Image could not be prepared."); }
        }} />
      </label>
      {(value || visibleAssetId) ? <button type="button" className="text-button" onClick={() => onChange(null)}>Remove image</button> : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}
