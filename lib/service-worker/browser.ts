"use client";

import { useEffect, useState } from "react";

import { ServiceWorkerUpdateCoordinator, type ServiceWorkerUpdateState } from "./update";

export interface BrowserServiceWorkerState extends ServiceWorkerUpdateState {
  applyUpdate: () => void;
}

const initialState: ServiceWorkerUpdateState = { updateAvailable: false };

export function useServiceWorkerUpdate(): BrowserServiceWorkerState {
  const [state, setState] = useState(initialState);
  const [coordinator, setCoordinator] = useState<ServiceWorkerUpdateCoordinator | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

    let active = true;
    let nextCoordinator: ServiceWorkerUpdateCoordinator | null = null;
    let observer: MutationObserver | null = null;

    void navigator.serviceWorker.register("/service-worker.js", {
      scope: "/",
      type: "module",
      updateViaCache: "none",
    }).then((registration) => {
      if (!active) return;
      const isEditing = () => Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
      nextCoordinator = new ServiceWorkerUpdateCoordinator({
        registration,
        container: navigator.serviceWorker,
        onState: setState,
        reload: () => window.location.reload(),
        isEditing,
      });
      nextCoordinator.start();
      setCoordinator(nextCoordinator);

      observer = new MutationObserver(() => nextCoordinator?.resumeReloadIfReady());
      observer.observe(document.body, { childList: true, subtree: true });
    }).catch(() => {
      console.warn("Fastidious service worker registration failed.");
    });

    return () => {
      active = false;
      observer?.disconnect();
      nextCoordinator?.stop();
    };
  }, []);

  return {
    ...state,
    applyUpdate: () => coordinator?.applyUpdate(),
  };
}
