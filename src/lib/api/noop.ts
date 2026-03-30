import type { BoardApi } from "./interface";
import { generateUUID } from "./uuid";

/**
 * Local-only (noop) implementation of BoardApi.
 *
 * All write operations resolve immediately without network calls.
 * UUID generation and timestamp formatting are preserved so callers
 * can write the results to IndexedDB as before.
 */
export const noopApi: BoardApi = {
  async login() {
    throw new Error("Aurora API is offline. Login is not available.");
  },

  async logAscent() {
    return generateUUID();
  },

  async logBid() {
    return generateUUID();
  },

  async deleteAscent() {},
  async deleteBid() {},

  async saveClimb() {},
  async deleteClimb() {},

  async createCircuit() {},
  async deleteCircuit() {},
  async saveCircuitClimbs() {},

  async saveTag() {},

  async fetchClimbBeta() {
    return [];
  },

  async checkLinksValid(urls: string[]) {
    return new Set(urls);
  },

  async syncSharedData() {
    return {};
  },

  async syncUserData() {
    return {};
  },
};
