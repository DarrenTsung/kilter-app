/** Format an ISO timestamp as a compact, human-readable relative/absolute time. */
export function formatRelativeTime(
  iso: string | null | undefined,
  now: number = Date.now()
): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const diff = now - then;

  if (diff < 45_000) return "just now";

  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return mins === 1 ? "1 min ago" : `${mins} mins ago`;

  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return hours === 1 ? "1 hr ago" : `${hours} hrs ago`;

  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;

  return new Date(then).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
