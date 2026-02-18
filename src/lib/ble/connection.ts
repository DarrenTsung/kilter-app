/**
 * Web Bluetooth lifecycle: scan, connect, write, reconnect, auto-disconnect.
 * Device and characteristic refs live here as module-level variables
 * (not serializable — can't go in Zustand).
 */

import { splitIntoChunks } from "./protocol";
import { useBleStore } from "@/store/bleStore";
import { useFilterStore } from "@/store/filterStore";

const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const WRITE_CHARACTERISTIC_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const CHUNK_DELAY_MS = 10;

let device: BluetoothDevice | null = null;
let characteristic: BluetoothRemoteGATTCharacteristic | null = null;
let autoDisconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** Parse API level from device name like "Kilter#abc123@3" */
function parseApiLevel(name?: string): number {
  if (!name) return 2;
  const match = name.match(/@(\d+)/);
  return match ? parseInt(match[1], 10) : 2;
}

/** Request a new BLE connection via the browser device picker */
export async function requestConnection(): Promise<void> {
  const store = useBleStore.getState();
  store.setStatus("scanning");

  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "Kilter" }],
      optionalServices: [SERVICE_UUID],
    });

    store.setStatus("connecting");

    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    characteristic = await service.getCharacteristic(WRITE_CHARACTERISTIC_UUID);

    const apiLevel = parseApiLevel(device.name);
    store.setApiLevel(apiLevel);
    store.setDeviceName(device.name ?? "Kilter Board");
    store.setStatus("connected");

    // Listen for unexpected disconnects
    device.addEventListener("gattserverdisconnected", handleDisconnect);
  } catch (err) {
    // User cancelled the picker — just go back to disconnected
    if (err instanceof Error && err.message.includes("cancelled")) {
      store.setStatus("disconnected");
    } else {
      store.setError(
        err instanceof Error ? err.message : "Connection failed"
      );
    }
    device = null;
    characteristic = null;
  }
}

/** Reconnect to a previously-paired device (no user gesture needed) */
export async function reconnect(): Promise<void> {
  if (!device?.gatt) return;
  const store = useBleStore.getState();
  store.setStatus("connecting");

  try {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    characteristic = await service.getCharacteristic(WRITE_CHARACTERISTIC_UUID);
    store.setStatus("connected");
  } catch (err) {
    store.setError(err instanceof Error ? err.message : "Reconnect failed");
    characteristic = null;
  }
}

/** Explicit disconnect + clear refs */
export function disconnect(): void {
  clearAutoDisconnectTimer();
  if (device?.gatt?.connected) {
    device.gatt.disconnect();
  }
  device = null;
  characteristic = null;
  useBleStore.getState().reset();
}

/** Handle unexpected GATT disconnection */
function handleDisconnect() {
  characteristic = null;
  clearAutoDisconnectTimer();
  useBleStore.getState().setStatus("disconnected");
}

/** Write a complete BLE packet (already built), splitting into 20-byte chunks */
export async function writePacket(data: Uint8Array): Promise<void> {
  if (!characteristic) throw new Error("Not connected");

  const chunks = splitIntoChunks(data);
  for (let i = 0; i < chunks.length; i++) {
    await characteristic.writeValue(chunks[i] as unknown as ArrayBuffer);
    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
    }
  }
}

/** Schedule auto-disconnect after a write completes */
export function scheduleAutoDisconnect(): void {
  clearAutoDisconnectTimer();
  const seconds = useFilterStore.getState().autoDisconnect;
  if (seconds > 0) {
    autoDisconnectTimer = setTimeout(() => disconnect(), seconds * 1000);
  }
}

function clearAutoDisconnectTimer(): void {
  if (autoDisconnectTimer) {
    clearTimeout(autoDisconnectTimer);
    autoDisconnectTimer = null;
  }
}

/** Check if we're currently connected */
export function isConnected(): boolean {
  return useBleStore.getState().status === "connected";
}
