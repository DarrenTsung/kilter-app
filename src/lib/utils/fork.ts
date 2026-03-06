/** Tag appended to description for forked climbs */
const FORK_TAG_RE = /\[fork:([a-f0-9]+)\]/;

/** Extract the source climb UUID from a forked climb's description */
export function parseForkSource(description: string): string | null {
  const match = description.match(FORK_TAG_RE);
  return match ? match[1] : null;
}

/** Build a fork tag to embed in the description */
export function buildForkTag(sourceUuid: string): string {
  return `[fork:${sourceUuid}]`;
}

/** Strip the fork tag from a description for display */
export function stripForkTag(description: string): string {
  return description.replace(FORK_TAG_RE, "").trim();
}
