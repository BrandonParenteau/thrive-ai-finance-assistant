/**
 * Global callback module for the Monthly Summary modal.
 * Registered once in _layout.tsx; called from the notification tap handler.
 * This avoids prop-drilling and lets any component trigger the modal.
 */

let _callback: (() => void) | null = null;

export function registerMonthlySummaryCallback(cb: () => void): void {
  _callback = cb;
}

export function openMonthlySummary(): void {
  _callback?.();
}
