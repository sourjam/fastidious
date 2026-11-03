"use client";

import { useEffect, useState } from "react";
import type { CivilDate } from "@/lib/domain/calendar";
import type { FastidiousDatabase } from "@/lib/local-db/database";
import { useServiceWorkerUpdate } from "@/lib/service-worker/browser";
import { CalendarScreen } from "../calendar/CalendarScreen";
import { FastScreen } from "../fast/FastScreen";
import { StatsScreen } from "../stats/StatsScreen";
import { TodayScreen } from "../today/TodayScreen";
import { InstallCard } from "../install/InstallCard";
import { SettingsScreen } from "../settings/SettingsScreen";
import { applyTheme, isThemePreference, THEME_STORAGE_KEY, type ThemePreference } from "../theme";
import { Button } from "../ui/Button";
import { StatusNotice } from "../ui/StatusNotice";
import { Header } from "./Header";
import { TabBar, type AppTab } from "./TabBar";

interface AppShellProps {
  initializing?: boolean;
  error?: string;
  accessLink?: string;
  onRotate?: () => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  onLocalChange?: () => void;
  settingsDatabase?: FastidiousDatabase;
}

export function AppShell({ initializing = false, error, accessLink, onRotate, onRemove, onLocalChange, settingsDatabase }: AppShellProps) {
  const [selectedTab, setSelectedTab] = useState<AppTab>("fast");
  const [todayDate, setTodayDate] = useState<CivilDate>();
  const [date, setDate] = useState("");
  const [offline, setOffline] = useState(false);
  const serviceWorker = useServiceWorkerUpdate();

  useEffect(() => {
    setDate(new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date()));
    const updateOnlineState = () => setOffline(!navigator.onLine);
    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    const preference = isThemePreference(saved) ? saved : "system";
    applyTheme(document.documentElement, preference, media);

    const updateSystemTheme = () => {
      if ((localStorage.getItem(THEME_STORAGE_KEY) ?? "system") === "system") {
        applyTheme(document.documentElement, "system", media);
      }
    };
    media.addEventListener?.("change", updateSystemTheme);
    return () => media.removeEventListener?.("change", updateSystemTheme);
  }, []);

  function changeTheme(preference: ThemePreference) {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
    const media = window.matchMedia?.("(prefers-color-scheme: dark)") ?? { matches: false };
    applyTheme(document.documentElement, preference, media);
  }

  return (
    <div className="app-frame">
      <Header date={date || "Today"} offline={offline} error={error} />
      <main className="app-main" aria-busy={initializing}>
        {serviceWorker.updateAvailable ? (
          <StatusNotice tone="status">
            <div className="update-notice">
              <span>A new version is available.</span>
              <Button onClick={serviceWorker.applyUpdate}>Update</Button>
            </div>
          </StatusNotice>
        ) : null}
        {error ? <StatusNotice tone="error">{error}</StatusNotice> : null}
        {initializing ? <LoadingPanel /> : null}
        {!initializing && selectedTab === "fast" ? <FastScreen onLocalChange={onLocalChange} /> : null}
        {!initializing && selectedTab === "today" ? (
          <TodayScreen database={settingsDatabase} initialDate={todayDate} onLocalChange={onLocalChange} />
        ) : null}
        {!initializing && selectedTab === "calendar" ? <CalendarScreen database={settingsDatabase} onLocalChange={onLocalChange} onOpenDayLog={(selectedDate) => { setTodayDate(selectedDate); setSelectedTab("today"); }} /> : null}
        {!initializing && selectedTab === "stats" ? <StatsScreen onLocalChange={onLocalChange} /> : null}
        {!initializing && selectedTab === "you" ? (
          <SettingsScreen
            database={settingsDatabase}
            accessLink={accessLink}
            onRotate={onRotate}
            onRemove={onRemove}
            onLocalChange={onLocalChange}
            onThemeChange={changeTheme}
          />
        ) : null}
        <InstallCard show={!initializing && selectedTab === "you"} />
      </main>
      <TabBar selected={selectedTab} onSelect={setSelectedTab} />
    </div>
  );
}

function LoadingPanel() {
  return (
    <section className="shell-panel loading-panel" aria-label="Loading">
      <span className="panel-kicker">Preparing your log</span>
      <div className="loading-line loading-line-wide" />
      <div className="loading-line" />
      <span className="visually-hidden">Loading Fastidious</span>
    </section>
  );
}
