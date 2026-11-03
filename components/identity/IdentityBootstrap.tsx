"use client";

import { useEffect, useRef, useState } from "react";

import { AppShell } from "../shell/AppShell";
import { Button } from "../ui/Button";
import { StatusNotice } from "../ui/StatusNotice";
import { BootstrapController, type BootstrapState } from "@/lib/identity/bootstrap";
import { browserIdentityApi, browserIdentityLocation, createBrowserLocalIdentityData } from "@/lib/identity/browser";
import { browserCredentialStore } from "@/lib/identity/credential-store";
import { ForegroundSyncCoordinator } from "@/lib/sync/browser";
import { PendingImageCoordinator } from "@/lib/images/browser";

const IDENTITY_CHANNEL = "fastidious-identity";

export function IdentityBootstrap() {
  const [state, setState] = useState<BootstrapState>({ step: "reading-location" });
  const [syncError, setSyncError] = useState<string>();
  const controller = useRef<BootstrapController | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const broadcastedRevocation = useRef(false);
  const sync = useRef<ForegroundSyncCoordinator | null>(null);
  const images = useRef<PendingImageCoordinator | null>(null);

  useEffect(() => {
    let active = true;
    void createBrowserLocalIdentityData().then((local) => {
      if (!active) return;
      const next = new BootstrapController({
        credentials: browserCredentialStore,
        location: browserIdentityLocation,
        api: browserIdentityApi,
        local,
        isOnline: () => navigator.onLine,
        defaults: () => ({
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          weightUnit: "kg",
        }),
        onState: setState,
      });
      controller.current = next;
      void next.start();
      if (typeof BroadcastChannel !== "undefined") {
        const identityChannel = new BroadcastChannel(IDENTITY_CHANNEL);
        channel.current = identityChannel;
        identityChannel.addEventListener("message", (event) => {
          if (event.data === "rotated") {
            const secret = browserCredentialStore.read();
            if (secret) next.receiveRotation(secret);
          } else if (event.data === "revoked") {
            void next.receiveRevocation();
          }
        });
      }
    });
    return () => {
      active = false;
      channel.current?.close();
    };
  }, []);

  useEffect(() => {
    if (state.step === "ready" && !sync.current) {
      const coordinator = new ForegroundSyncCoordinator({
        readSecret: () => browserCredentialStore.read(),
        onRevoked: () => controller.current?.receiveRevocation(),
        onExpired: () => controller.current?.receiveExpiration(),
        onPersistentError: (code) => setSyncError(code ? "Changes are saved locally, but synchronization needs attention." : undefined),
      });
      sync.current = coordinator;
      const imageCoordinator = new PendingImageCoordinator(
        () => browserCredentialStore.read(),
        () => coordinator.request(),
      );
      images.current = imageCoordinator;
      void coordinator.start();
      void imageCoordinator.start();
    } else if (state.step !== "ready" && sync.current) {
      sync.current.stop();
      sync.current = null;
      images.current?.stop();
      images.current = null;
    }
    return () => {
      sync.current?.stop();
      sync.current = null;
      images.current?.stop();
      images.current = null;
    };
  }, [state.step]);

  useEffect(() => {
    if (state.step === "revoked" && !broadcastedRevocation.current) {
      broadcastedRevocation.current = true;
      channel.current?.postMessage("revoked");
    }
  }, [state.step]);

  if (state.step === "ready" && state.secret) {
    const accessLink = `${window.location.origin}/#/log/${state.secret}`;
    return (
      <AppShell
        error={syncError}
        accessLink={accessLink}
        onRotate={async () => {
          const rotated = await controller.current?.rotate();
          if (rotated?.step === "ready" && rotated.secret !== state.secret) channel.current?.postMessage("rotated");
        }}
        onRemove={async () => {
          await controller.current?.removeFromDevice();
        }}
        onLocalChange={() => { sync.current?.request(); images.current?.request(); }}
      />
    );
  }

  if (["reading-location", "opening-fragment-log", "restoring-local-log", "creating-log", "loading-local"].includes(state.step)) {
    return <AppShell initializing />;
  }

  return (
    <main className="identity-screen">
      <span className="panel-kicker">Access</span>
      <h1>{titleFor(state.step)}</h1>
      <StatusNotice tone={state.step === "offline-first-load" ? "info" : "error"}>
        {state.message ?? "Fastidious could not open this log."}
      </StatusNotice>
      {state.recoverySecret ? (
        <div className="recovery-link">
          <strong>New access link</strong>
          <code>{`${window.location.origin}/#/log/${state.recoverySecret}`}</code>
          <Button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/#/log/${state.recoverySecret}`)}>
            Copy link
          </Button>
        </div>
      ) : null}
      <Button variant="primary" onClick={() => void (state.step === "offline-first-load" ? controller.current?.start() : controller.current?.create())}>
        {state.step === "offline-first-load" ? "Retry" : "Create new log"}
      </Button>
    </main>
  );
}

function titleFor(step: BootstrapState["step"]): string {
  if (step === "offline-first-load") return "Connect to get started";
  if (step === "expired") return "This log expired";
  if (step === "revoked") return "Access revoked";
  if (step === "invalid-link") return "Invalid access link";
  return "Something went wrong";
}
