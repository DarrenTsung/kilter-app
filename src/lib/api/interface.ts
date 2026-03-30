/** Shared type interfaces for the board API */

export interface LoginSession {
  token: string;
  user_id: number;
}

export interface AscentData {
  climb_uuid: string;
  angle: number;
  bid_count: number;
  quality: number;
  difficulty: number;
  comment: string;
  climbed_at?: string;
}

export interface BidData {
  climb_uuid: string;
  angle: number;
  bid_count: number;
  comment: string;
  climbed_at?: string;
}

export interface ClimbSaveData {
  uuid: string;
  layoutId: number;
  setterId: number;
  name: string;
  description: string;
  frames: string;
  angle: number;
  isDraft: boolean;
  isNoMatch: boolean;
}

export interface CircuitCreateData {
  uuid: string;
  userId: number;
  name: string;
  description: string;
  color: string;
  isPublic: boolean;
}

export interface ApiBetaLink {
  climb_uuid: string;
  foreign_username?: string | null;
  link: string;
  angle: number | null;
  is_listed: boolean;
}

export interface SyncProgress {
  stage: string;
  detail?: string;
}

/**
 * Abstract interface for the board API backend.
 *
 * Callers program against this interface so the backend implementation
 * can be swapped (Aurora, noop/local-only, or a future replacement).
 */
export interface BoardApi {
  login(username: string, password: string): Promise<LoginSession>;

  logAscent(token: string, userId: number, data: AscentData): Promise<string>;
  logBid(token: string, userId: number, data: BidData): Promise<string>;
  deleteAscent(token: string, uuid: string): Promise<void>;
  deleteBid(token: string, uuid: string): Promise<void>;

  saveClimb(token: string, data: ClimbSaveData): Promise<void>;
  deleteClimb(token: string, uuid: string): Promise<void>;

  createCircuit(token: string, circuit: CircuitCreateData): Promise<void>;
  deleteCircuit(token: string, uuid: string): Promise<void>;
  saveCircuitClimbs(token: string, circuitUuid: string, climbUuids: string[]): Promise<void>;

  saveTag(token: string, userId: number, climbUuid: string, isBlocked: boolean): Promise<void>;

  fetchClimbBeta(token: string, climbUuid: string): Promise<ApiBetaLink[]>;
  checkLinksValid(urls: string[]): Promise<Set<string>>;

  syncSharedData(
    token: string,
    onProgress?: (progress: SyncProgress) => void,
    signal?: AbortSignal,
  ): Promise<Record<string, number>>;
  syncUserData(
    token: string,
    userId: number,
    onProgress?: (progress: SyncProgress) => void,
    signal?: AbortSignal,
  ): Promise<Record<string, number>>;
}
