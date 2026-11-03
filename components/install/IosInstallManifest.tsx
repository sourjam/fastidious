"use client";

import { useEffect } from "react";
import { detectInstallPlatform, isStandalone } from "./InstallCard";

export function IosInstallManifest() {
  useEffect(() => {
    if (detectInstallPlatform(navigator) !== "ios" || isStandalone(window, navigator)) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) return;

    const originalHref = link.getAttribute("href") ?? "/manifest.webmanifest";
    link.setAttribute("href", "/manifest-ios.webmanifest");
    return () => {
      link.setAttribute("href", originalHref);
    };
  }, []);

  return null;
}
