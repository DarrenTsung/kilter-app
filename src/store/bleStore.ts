import { create } from "zustand";

export type BleStatus =
  | "disconnected"
  | "scanning"
  | "connecting"
  | "connected"
  | "error";

interface BleState {
  status: BleStatus;
  deviceName: string | null;
  apiLevel: number;
  error: string | null;
  isSending: boolean;

  setStatus: (status: BleStatus) => void;
  setDeviceName: (name: string | null) => void;
  setApiLevel: (level: number) => void;
  setError: (error: string | null) => void;
  setSending: (sending: boolean) => void;
  reset: () => void;
}

/**
 * Ephemeral BLE state — NOT persisted.
 * Device refs live in connection.ts as module-level variables
 * since BluetoothDevice is not serializable.
 */
export const useBleStore = create<BleState>()((set) => ({
  status: "disconnected",
  deviceName: null,
  apiLevel: 2,
  error: null,
  isSending: false,

  setStatus: (status) => set({ status, error: status === "error" ? undefined : null }),
  setDeviceName: (deviceName) => set({ deviceName }),
  setApiLevel: (apiLevel) => set({ apiLevel }),
  setError: (error) => set({ error, status: "error" }),
  setSending: (isSending) => set({ isSending }),
  reset: () =>
    set({
      status: "disconnected",
      deviceName: null,
      apiLevel: 2,
      error: null,
      isSending: false,
    }),
}));
