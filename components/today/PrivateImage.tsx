"use client";

import { useEffect, useState } from "react";

import { browserCredentialStore } from "@/lib/identity/credential-store";

export function PrivateImage({ assetId, variant, className, alt }: { assetId: string; variant: "thumbnail" | "preview"; className?: string; alt: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let active = true;
    const secret = browserCredentialStore.read();
    if (!secret) return;
    void fetch(`/api/images/${encodeURIComponent(assetId)}?variant=${variant}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) throw new Error("Image unavailable.");
      const blob = await response.blob();
      const reader = new FileReader();
      const src = await new Promise<string>((resolve, reject) => {
        reader.addEventListener("load", () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Image unavailable.")));
        reader.addEventListener("error", () => reject(new Error("Image unavailable.")));
        reader.readAsDataURL(blob);
      });
      if (active) setSrc(src);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [assetId, variant]);
  return src ? <img className={className} src={src} alt={alt} /> : null;
}
