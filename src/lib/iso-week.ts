export function isoWeek(iso: string): number {
  const d = new Date(iso + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fday + 3);
  return (
    1 +
    Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
  );
}

export function deriveDateParts(iso: string): {
  year: number;
  bimester: number;
  week: number;
} {
  const d = new Date(iso + "T00:00:00");
  return {
    year: d.getFullYear(),
    bimester: Math.floor(d.getMonth() / 2) + 1,
    week: isoWeek(iso),
  };
}
