import type { FastRecord, IanaTimezone } from "./types";

export type CivilDate = `${number}-${string}-${string}`;

export interface CivilDay {
  date: CivilDate;
  startAt: number;
  endAt: number;
}

const datePartsFormatter = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = datePartsFormatter.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    datePartsFormatter.set(timezone, formatter);
  }
  return formatter;
}

function zonedParts(epochMilliseconds: number, timezone: string) {
  const values: Record<string, number> = {};
  for (const part of partsFormatter(timezone).formatToParts(epochMilliseconds)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
  };
}

export function civilDateParts(date: CivilDate): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`Invalid civil date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function civilDateFromUtcDate(date: Date): CivilDate {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}` as CivilDate;
}

export function addCivilDays(date: CivilDate, days: number): CivilDate {
  const parts = civilDateParts(date);
  return civilDateFromUtcDate(new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days)));
}

export function civilDateAt(epochMilliseconds: number, timezone: IanaTimezone | string): CivilDate {
  const parts = zonedParts(epochMilliseconds, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}` as CivilDate;
}

function startOfCivilDate(date: CivilDate, timezone: IanaTimezone | string): number {
  const desired = civilDateParts(date);
  const desiredAsUtc = Date.UTC(desired.year, desired.month - 1, desired.day);
  let candidate = desiredAsUtc;

  // Correct a UTC guess by observing how Intl represents it in the target zone.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(candidate, timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const correction = desiredAsUtc - actualAsUtc;
    candidate += correction;
    if (correction === 0) break;
  }
  return candidate;
}

export function civilDay(date: CivilDate, timezone: IanaTimezone | string): CivilDay {
  return {
    date,
    startAt: startOfCivilDate(date, timezone),
    endAt: startOfCivilDate(addCivilDays(date, 1), timezone),
  };
}

export function startOfDay(epochMilliseconds: number, timezone: IanaTimezone | string): number {
  return civilDay(civilDateAt(epochMilliseconds, timezone), timezone).startAt;
}

export function endOfDay(epochMilliseconds: number, timezone: IanaTimezone | string): number {
  return civilDay(civilDateAt(epochMilliseconds, timezone), timezone).endAt;
}

export interface DayOverlap {
  date: CivilDate;
  startAt: number;
  endAt: number;
  milliseconds: number;
}

export function splitFastAcrossDays(
  fast: Pick<FastRecord, "startAt" | "endAt">,
  timezone: IanaTimezone | string,
  now: number,
): DayOverlap[] {
  const clippedEnd = Math.min(fast.endAt ?? now, now);
  if (clippedEnd <= fast.startAt) return [];

  const overlaps: DayOverlap[] = [];
  let date = civilDateAt(fast.startAt, timezone);
  const finalDate = civilDateAt(clippedEnd - 1, timezone);
  while (date <= finalDate) {
    const day = civilDay(date, timezone);
    const startAt = Math.max(fast.startAt, day.startAt);
    const endAt = Math.min(clippedEnd, day.endAt);
    if (endAt > startAt) overlaps.push({ date, startAt, endAt, milliseconds: endAt - startAt });
    date = addCivilDays(date, 1);
  }
  return overlaps;
}

export function totalFastedForDay(
  date: CivilDate,
  fasts: readonly FastRecord[],
  timezone: IanaTimezone | string,
  now: number,
): number {
  const day = civilDay(date, timezone);
  return fasts.reduce((total, fast) => {
    if (fast.deletedAt !== null) return total;
    const endAt = Math.min(fast.endAt ?? now, now, day.endAt);
    const startAt = Math.max(fast.startAt, day.startAt);
    return total + Math.max(0, endAt - startAt);
  }, 0);
}

export type IntensityBucket = 0 | 1 | 2 | 3 | 4 | 5;

export function intensityBucket(hours: number): IntensityBucket {
  if (hours <= 0) return 0;
  if (hours < 8) return 1;
  if (hours < 14) return 2;
  if (hours < 18) return 3;
  if (hours < 22) return 4;
  return 5;
}

export function intensityLabel(bucket: IntensityBucket): string {
  return ["no fasting", "under 8 hours", "8 to under 14 hours", "14 to under 18 hours", "18 to under 22 hours", "22 hours or more"][bucket]!;
}

export interface DayClockSegment {
  startFraction: number;
  endFraction: number;
  live: boolean;
}

export function dayClockSegments(
  day: CivilDay,
  fasts: readonly FastRecord[],
  now: number,
): DayClockSegment[] {
  const duration = day.endAt - day.startAt;
  return fasts.flatMap((fast) => {
    if (fast.deletedAt !== null) return [];
    const startAt = Math.max(fast.startAt, day.startAt);
    const endAt = Math.min(fast.endAt ?? now, now, day.endAt);
    if (endAt <= startAt) return [];
    return [{
      startFraction: (startAt - day.startAt) / duration,
      endFraction: (endAt - day.startAt) / duration,
      live: fast.endAt === null,
    }];
  });
}

function totalsByCivilDate(
  startDate: CivilDate,
  endDate: CivilDate,
  fasts: readonly FastRecord[],
  timezone: IanaTimezone | string,
  now: number,
): Map<CivilDate, number> {
  const rangeStart = civilDay(startDate, timezone).startAt;
  const rangeEnd = civilDay(endDate, timezone).startAt;
  const totals = new Map<CivilDate, number>();
  for (const fast of fasts) {
    const fastEnd = fast.endAt ?? now;
    if (fast.deletedAt !== null || fast.startAt >= rangeEnd || fastEnd <= rangeStart) continue;
    const clipped = {
      startAt: Math.max(fast.startAt, rangeStart) as FastRecord["startAt"],
      endAt: Math.min(fastEnd, rangeEnd) as FastRecord["endAt"],
    };
    for (const overlap of splitFastAcrossDays(clipped, timezone, now)) {
      totals.set(overlap.date, (totals.get(overlap.date) ?? 0) + overlap.milliseconds);
    }
  }
  return totals;
}

export type FirstWeekday = 0 | 1;

export function firstWeekday(locale: string): FirstWeekday {
  const localeInfo = new Intl.Locale(locale) as Intl.Locale & {
    getWeekInfo?: () => { firstDay: number };
    weekInfo?: { firstDay: number };
  };
  const firstDay = localeInfo.getWeekInfo?.().firstDay ?? localeInfo.weekInfo?.firstDay;
  if (firstDay !== undefined) return firstDay === 7 ? 0 : 1;

  const region = localeInfo.region ?? localeInfo.maximize().region;
  const sundayFirstRegions = new Set(["US", "CA", "JP", "PH", "TW", "HK", "MX", "BR", "AU", "NZ", "ZA"]);
  return region && sundayFirstRegions.has(region) ? 0 : 1;
}

export interface MonthCell {
  date: CivilDate;
  inMonth: boolean;
  milliseconds: number;
  intensity: IntensityBucket;
}

export function monthGrid(
  year: number,
  month: number,
  fasts: readonly FastRecord[],
  timezone: IanaTimezone | string,
  locale: string,
  now: number,
): MonthCell[] {
  const first = `${year}-${String(month).padStart(2, "0")}-01` as CivilDate;
  const firstParts = civilDateParts(first);
  const weekday = new Date(Date.UTC(firstParts.year, firstParts.month - 1, 1)).getUTCDay();
  const leading = (weekday - firstWeekday(locale) + 7) % 7;
  const gridStart = addCivilDays(first, -leading);
  const gridEnd = addCivilDays(gridStart, 42);
  const totals = totalsByCivilDate(gridStart, gridEnd, fasts, timezone, now);

  return Array.from({ length: 42 }, (_, index) => {
    const date = addCivilDays(gridStart, index);
    const milliseconds = totals.get(date) ?? 0;
    return {
      date,
      inMonth: date.startsWith(`${year}-${String(month).padStart(2, "0")}-`),
      milliseconds,
      intensity: intensityBucket(milliseconds / 3_600_000),
    };
  });
}

export interface YearHeatmapValue {
  date: CivilDate;
  milliseconds: number;
  intensity: IntensityBucket;
}

export function yearHeatmap(
  year: number,
  fasts: readonly FastRecord[],
  timezone: IanaTimezone | string,
  now: number,
): YearHeatmapValue[] {
  const values: YearHeatmapValue[] = [];
  let date = `${year}-01-01` as CivilDate;
  const totals = totalsByCivilDate(date, `${year + 1}-01-01` as CivilDate, fasts, timezone, now);
  while (date.startsWith(`${year}-`)) {
    const milliseconds = totals.get(date) ?? 0;
    values.push({ date, milliseconds, intensity: intensityBucket(milliseconds / 3_600_000) });
    date = addCivilDays(date, 1);
  }
  return values;
}
