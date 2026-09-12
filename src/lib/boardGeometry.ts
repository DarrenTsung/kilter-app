import type { BoardBounds } from "./bodyModel";

/**
 * Geometry of the 7x10 homewall (product_size_id=17, layout_id=8).
 *
 * The board drawing is uniformly scaled: `hole.x` / `hole.y` are inches, and
 * the rendered image is `imgWidth` wide for `EDGE_RIGHT - EDGE_LEFT` inches.
 * That is what lets the body overlay size a climber in real units.
 */
export const EDGE_LEFT = -44;
export const EDGE_RIGHT = 44;
export const EDGE_BOTTOM = 24;
export const EDGE_TOP = 144;

export const BOARD_WIDTH_INCHES = EDGE_RIGHT - EDGE_LEFT; // 88
export const BOARD_HEIGHT_INCHES = EDGE_TOP - EDGE_BOTTOM; // 120

export const BOARD_IMAGES = [
  "/board/product_sizes_layouts_sets/55-v2.png", // mainline (set 26)
  "/board/product_sizes_layouts_sets/56-v3.png", // auxiliary (set 27)
];

export const LAYOUT_ID = 8;

export const BOARD_BOUNDS: BoardBounds = {
  left: EDGE_LEFT,
  right: EDGE_RIGHT,
  bottom: EDGE_BOTTOM,
  top: EDGE_TOP,
};

/** SVG units per inch, from the rendered board image size. */
export function boardSpacing(imgWidth: number, imgHeight: number) {
  return {
    xSpacing: imgWidth / BOARD_WIDTH_INCHES,
    ySpacing: imgHeight / BOARD_HEIGHT_INCHES,
  };
}

/** board inches -> SVG viewBox units */
export function toSvgX(x: number, xSpacing: number) {
  return (x - EDGE_LEFT) * xSpacing;
}
export function toSvgY(y: number, ySpacing: number, imgHeight: number) {
  return imgHeight - (y - EDGE_BOTTOM) * ySpacing;
}

/** Map a placement role name onto the four role categories. */
export type RoleCategory = "hand" | "foot" | "start" | "finish";

export function roleCategoryFromName(name: string): RoleCategory | null {
  const n = name.toLowerCase();
  if (n.includes("start")) return "start";
  if (n.includes("finish") || n.includes("top")) return "finish";
  if (n.includes("foot") || n.includes("feet")) return "foot";
  if (n.includes("hand") || n.includes("middle")) return "hand";
  return null;
}

export const KILTER_PRODUCT_ID = 7;
