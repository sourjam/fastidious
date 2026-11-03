import { firstWeekday, type FirstWeekday } from "./calendar";
import type { IanaTimezone } from "./types";

export const FALLBACK_TIMEZONE = "UTC" as IanaTimezone;

export function isValidTimezone(value: string): value is IanaTimezone {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function detectTimezone(
  detected = Intl.DateTimeFormat().resolvedOptions().timeZone,
  fallback: IanaTimezone = FALLBACK_TIMEZONE,
): IanaTimezone {
  return detected && isValidTimezone(detected) ? detected : fallback;
}

export function localeFirstWeekday(locale: string): FirstWeekday {
  return firstWeekday(locale);
}

export function formatDate(
  epochMilliseconds: number,
  locale: string,
  timezone: IanaTimezone | string,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" },
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone }).format(epochMilliseconds);
}

export function formatTime(
  epochMilliseconds: number,
  locale: string,
  timezone: IanaTimezone | string,
  options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" },
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone }).format(epochMilliseconds);
}

export function formatDateTime(
  epochMilliseconds: number,
  locale: string,
  timezone: IanaTimezone | string,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(epochMilliseconds);
}
