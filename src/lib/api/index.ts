import { noopApi } from "./noop";
// import { auroraApi } from "./aurora-impl";

/**
 * Active API binding. Swap to auroraApi (or a future replacement) when ready.
 */
export const api = noopApi;

// Re-export types and utilities so callers only need `@/lib/api`
export type {
  BoardApi,
  LoginSession,
  AscentData,
  BidData,
  ClimbSaveData,
  CircuitCreateData,
  ApiBetaLink,
  SyncProgress,
} from "./interface";
export { generateUUID } from "./uuid";
