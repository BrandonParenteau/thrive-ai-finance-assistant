/**
 * Imperative toast system.
 * Usage: import toast from "@/utils/toast"; toast.error("Something went wrong");
 * Pair with <ToastContainer /> rendered once at the app root (_layout.tsx).
 */

export type ToastType = "error" | "warning" | "success" | "info";

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

type ToastHandler = (toast: ToastMessage) => void;

let _handler: ToastHandler | null = null;
let _pending: ToastMessage[] = [];
let _counter = 0;

export function registerToastHandler(handler: ToastHandler): void {
  _handler = handler;
  // Drain any toasts that were queued before the container mounted
  const queued = _pending.splice(0);
  queued.forEach(handler);
}

function show(message: string, type: ToastType = "info", duration = 3_500): void {
  const t: ToastMessage = {
    id: `toast-${Date.now()}-${++_counter}`,
    message,
    type,
    duration,
  };
  if (_handler) {
    _handler(t);
  } else {
    _pending.push(t);
  }
}

const toast = {
  show,
  error: (message: string, duration?: number) => show(message, "error", duration),
  warning: (message: string, duration?: number) => show(message, "warning", duration),
  success: (message: string, duration?: number) => show(message, "success", duration),
  info: (message: string, duration?: number) => show(message, "info", duration),
};

export default toast;
