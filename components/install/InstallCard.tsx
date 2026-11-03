"use client";

import { useEffect, useState } from "react";
import { Blueprint } from "../ui/Blueprint";
import { Button } from "../ui/Button";

export const INSTALL_DISMISSED_KEY = "fastidious:install-dismissed";

export type InstallPlatform = "ios" | "other";

interface CapturedInstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

export function detectInstallPlatform(navigatorValue: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">): InstallPlatform {
  const iosDevice = /iPad|iPhone|iPod/.test(navigatorValue.userAgent);
  const modernIPad = navigatorValue.platform === "MacIntel" && navigatorValue.maxTouchPoints > 1;
  return iosDevice || modernIPad ? "ios" : "other";
}

export function isStandalone(windowValue: Window, navigatorValue: NavigatorWithStandalone): boolean {
  return windowValue.matchMedia?.("(display-mode: standalone)").matches === true || navigatorValue.standalone === true;
}

export function InstallCard({ show = true, platform }: { show?: boolean; platform?: InstallPlatform }) {
  const [installed, setInstalled] = useState(true);
  const [detectedPlatform, setDetectedPlatform] = useState<InstallPlatform>(platform ?? "other");
  const [prompt, setPrompt] = useState<CapturedInstallPrompt>();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setInstalled(isStandalone(window, navigator));
    setDetectedPlatform(platform ?? detectInstallPlatform(navigator));
    try {
      setDismissed(localStorage.getItem(INSTALL_DISMISSED_KEY) === "true");
    } catch {
      setDismissed(false);
    }

    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as CapturedInstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    return () => window.removeEventListener("beforeinstallprompt", capturePrompt);
  }, [platform]);

  function dismiss() {
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, "true");
    } catch {
      // Guidance still hides for this session when storage is unavailable.
    }
    setDismissed(true);
    setPrompt(undefined);
  }

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    dismiss();
  }

  if (!show || installed || dismissed || (!prompt && detectedPlatform !== "ios")) return null;

  return (
    <Blueprint className="settings-card install-card">
      <h2>Install Fastidious</h2>
      {prompt ? (
        <p>Keep Fastidious close at hand and open it in its own app window.</p>
      ) : (
        <>
          <p>On iPhone or iPad, tap Share, then Add to Home Screen.</p>
          <p>Install Fastidious before enabling push reminders.</p>
        </>
      )}
      <div className="settings-actions">
        {prompt ? <Button onClick={() => void install()}>Install Fastidious</Button> : null}
        <Button onClick={dismiss}>Not now</Button>
      </div>
    </Blueprint>
  );
}
