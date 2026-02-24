/**
 * Standard Kilter circuit colors with desaturated display variants.
 * API stores colors as bare 6-char hex (e.g. "FF0000").
 */
export const CIRCUIT_COLORS = [
  { api: "808080", display: "#8C8C8C", label: "Gray" },
  { api: "FF0000", display: "#E05252", label: "Red" },
  { api: "FF8000", display: "#DA7D2C", label: "Orange" },
  { api: "00CC00", display: "#43A764", label: "Green" },
  { api: "0000FF", display: "#5B7FD6", label: "Blue" },
  { api: "8000FF", display: "#9B6DD6", label: "Purple" },
  { api: "FF00FF", display: "#D16BD1", label: "Magenta" },
] as const;

const apiToDisplay = new Map(
  CIRCUIT_COLORS.map((c) => [c.api.toLowerCase(), c.display])
);

/** Map an API color (6-char hex, with or without '#') to its display color. Falls back to gray. */
export function circuitDisplayColor(apiColor: string): string {
  const clean = apiColor.replace(/^#/, "").toLowerCase();
  return apiToDisplay.get(clean) ?? CIRCUIT_COLORS[0].display;
}
