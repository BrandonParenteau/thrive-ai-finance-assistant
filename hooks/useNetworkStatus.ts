/**
 * Lightweight offline/online detection without requiring @react-native-community/netinfo.
 *
 * Strategy:
 *  - Web: listens to window "online" / "offline" events.
 *  - Native: state is driven by `setNetworkStatus()` calls from API catch blocks.
 *    When a fetch fails with a network error we call setNetworkStatus(false).
 *    When a fetch succeeds again we call setNetworkStatus(true).
 *
 * The OfflineBanner component subscribes via useNetworkStatus().
 */

import { useState, useEffect } from "react";
import { Platform } from "react-native";

let _isOnline = true;
const _listeners = new Set<(online: boolean) => void>();

function broadcast(online: boolean) {
  if (online === _isOnline) return;
  _isOnline = online;
  _listeners.forEach((l) => l(online));
}

// Web: native browser events are the most reliable source.
if (Platform.OS === "web" && typeof window !== "undefined") {
  window.addEventListener("online", () => broadcast(true));
  window.addEventListener("offline", () => broadcast(false));
  // Sync initial state
  _isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
}

/** Call from API catch blocks when a network error is detected. */
export function setNetworkOffline(): void {
  broadcast(false);
}

/** Call from API success paths to confirm connectivity is restored. */
export function setNetworkOnline(): void {
  broadcast(true);
}

/** Direct status setter — useful when you already know the desired state. */
export function setNetworkStatus(online: boolean): void {
  broadcast(online);
}

export function useNetworkStatus(): { isOnline: boolean } {
  const [isOnline, setIsOnline] = useState(_isOnline);

  useEffect(() => {
    const listener = (online: boolean) => setIsOnline(online);
    _listeners.add(listener);
    setIsOnline(_isOnline); // sync on mount in case state changed before hook ran
    return () => { _listeners.delete(listener); };
  }, []);

  return { isOnline };
}
