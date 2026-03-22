/**
 * Centralised Canadian English error message mappings.
 * Use mapError(err) to convert any thrown error into a user-friendly title + message.
 */

export type ErrorSeverity = "error" | "warning" | "info";

export interface MappedError {
  title: string;
  message: string;
  severity: ErrorSeverity;
}

// ─── Firebase Auth ────────────────────────────────────────────────────────────

const AUTH_MESSAGES: Record<string, MappedError> = {
  "auth/email-already-in-use": {
    title: "Email Already Registered",
    message: "An account with this email already exists. Try signing in instead.",
    severity: "error",
  },
  "auth/wrong-password": {
    title: "Incorrect Password",
    message: "The password you entered is incorrect. Please try again.",
    severity: "error",
  },
  "auth/user-not-found": {
    title: "Account Not Found",
    message: "No account was found with that email address. Please check and try again.",
    severity: "error",
  },
  "auth/invalid-credential": {
    title: "Invalid Credentials",
    message: "The email or password is incorrect. Please try again.",
    severity: "error",
  },
  "auth/invalid-email": {
    title: "Invalid Email",
    message: "Please enter a valid email address.",
    severity: "error",
  },
  "auth/weak-password": {
    title: "Password Too Weak",
    message: "Please choose a stronger password — at least 8 characters with a mix of letters and numbers.",
    severity: "error",
  },
  "auth/too-many-requests": {
    title: "Too Many Attempts",
    message: "Too many failed attempts. Please wait a few minutes and try again.",
    severity: "warning",
  },
  "auth/network-request-failed": {
    title: "No Internet Connection",
    message: "Couldn't connect to the network. Please check your connection and try again.",
    severity: "error",
  },
  "auth/email-not-verified": {
    title: "Email Not Verified",
    message: "Please verify your email address before signing in. Check your inbox for a verification link.",
    severity: "warning",
  },
  "auth/user-disabled": {
    title: "Account Disabled",
    message: "This account has been disabled. Please contact support if you think this is a mistake.",
    severity: "error",
  },
  "auth/requires-recent-login": {
    title: "Re-authentication Required",
    message: "For security reasons, please sign in again to continue.",
    severity: "warning",
  },
  "auth/popup-closed-by-user": {
    title: "Sign-in Cancelled",
    message: "The sign-in window was closed. Please try again.",
    severity: "info",
  },
  "auth/cancelled-popup-request": {
    title: "Sign-in Cancelled",
    message: "The sign-in request was cancelled.",
    severity: "info",
  },
  "auth/account-exists-with-different-credential": {
    title: "Account Already Exists",
    message: "An account with this email exists using a different sign-in method. Try signing in with email and password.",
    severity: "error",
  },
  "auth/expired-action-code": {
    title: "Link Expired",
    message: "This link has expired. Please request a new one.",
    severity: "error",
  },
  "auth/invalid-action-code": {
    title: "Invalid Link",
    message: "This link is invalid or has already been used. Please request a new one.",
    severity: "error",
  },
  "auth/operation-not-allowed": {
    title: "Sign-in Not Allowed",
    message: "This sign-in method is not currently enabled. Please contact support.",
    severity: "error",
  },
};

// ─── Firestore ────────────────────────────────────────────────────────────────

const FIRESTORE_MESSAGES: Record<string, MappedError> = {
  "permission-denied": {
    title: "Access Denied",
    message: "You don't have permission to access this data. Please sign in again.",
    severity: "error",
  },
  "not-found": {
    title: "Data Not Found",
    message: "The requested information couldn't be found.",
    severity: "error",
  },
  "unavailable": {
    title: "Offline — Changes Queued",
    message: "You appear to be offline. Your changes will sync automatically when you reconnect.",
    severity: "warning",
  },
  "already-exists": {
    title: "Already Exists",
    message: "This entry already exists.",
    severity: "error",
  },
  "resource-exhausted": {
    title: "Service Busy",
    message: "We're handling a lot of traffic right now. Please try again in a moment.",
    severity: "warning",
  },
  "failed-precondition": {
    title: "Sync Conflict",
    message: "A sync conflict occurred. Please refresh and try again.",
    severity: "error",
  },
  "deadline-exceeded": {
    title: "Request Timed Out",
    message: "The request took too long to complete. Please check your connection and try again.",
    severity: "error",
  },
  "internal": {
    title: "Something Went Wrong",
    message: "An internal error occurred. Please try again.",
    severity: "error",
  },
  "aborted": {
    title: "Transaction Conflict",
    message: "A concurrent update conflict occurred. Please try again.",
    severity: "error",
  },
  "data-loss": {
    title: "Data Error",
    message: "A data error occurred. Please contact support if this continues.",
    severity: "error",
  },
};

// ─── Plaid ────────────────────────────────────────────────────────────────────

export const PLAID_MESSAGES: Record<string, MappedError> = {
  ITEM_LOGIN_REQUIRED: {
    title: "Bank Re-authentication Required",
    message: "Your bank requires you to sign in again. Please reconnect your account.",
    severity: "warning",
  },
  INSTITUTION_NOT_SUPPORTED: {
    title: "Institution Not Supported",
    message: "Sorry, this financial institution isn't supported yet. Try another bank or add your account manually.",
    severity: "info",
  },
  INSTITUTION_NOT_AVAILABLE: {
    title: "Bank Temporarily Unavailable",
    message: "Your bank is temporarily unavailable. Please try again in a little while.",
    severity: "warning",
  },
  INSTITUTION_DOWN: {
    title: "Bank System Outage",
    message: "Your bank is experiencing a temporary outage. Please try again later.",
    severity: "warning",
  },
  INVALID_CREDENTIALS: {
    title: "Incorrect Bank Credentials",
    message: "Your bank login credentials weren't accepted. Please check your username and password and try again.",
    severity: "error",
  },
  INVALID_MFA: {
    title: "Verification Failed",
    message: "The verification code wasn't accepted. Please try again.",
    severity: "error",
  },
  RATE_LIMIT_EXCEEDED: {
    title: "Too Many Requests",
    message: "We've hit a rate limit with your bank. Please wait a few minutes and try again.",
    severity: "warning",
  },
  ITEM_ALREADY_EXISTS: {
    title: "Account Already Connected",
    message: "This bank account is already linked to your Thrive account.",
    severity: "info",
  },
  ACCESS_NOT_GRANTED: {
    title: "Access Denied",
    message: "Permission to access your bank account wasn't granted. Please try connecting again.",
    severity: "error",
  },
  NO_ACCOUNTS: {
    title: "No Accounts Found",
    message: "No eligible accounts were found at this institution.",
    severity: "info",
  },
  USER_SETUP_REQUIRED: {
    title: "Bank Setup Required",
    message: "Your bank account needs additional setup before it can be linked.",
    severity: "warning",
  },
  INSUFFICIENT_CREDENTIALS: {
    title: "Additional Information Required",
    message: "Your bank requires additional information to complete the connection.",
    severity: "error",
  },
  TRANSACTIONS_LIMIT: {
    title: "Transaction Limit Reached",
    message: "Transaction sync is temporarily limited. Please try again later.",
    severity: "warning",
  },
};

// ─── RevenueCat ───────────────────────────────────────────────────────────────

const RC_MESSAGES: Record<string, MappedError> = {
  "1": {
    title: "Purchase Error",
    message: "Something went wrong with your purchase. Please try again.",
    severity: "error",
  },
  "2": {
    title: "Purchase Cancelled",
    message: "The purchase was cancelled.",
    severity: "info",
  },
  "4": {
    title: "App Store Unavailable",
    message: "There's a problem with the App Store. Please try again later.",
    severity: "error",
  },
  "5": {
    title: "Purchases Not Allowed",
    message: "Purchases are not enabled on this device. Please check your device settings.",
    severity: "error",
  },
  "7": {
    title: "Payment Pending",
    message: "Your payment is being processed. Access will be granted once confirmed.",
    severity: "info",
  },
  "9": {
    title: "Not Eligible for Offer",
    message: "You're not eligible for this offer — you may have already used a trial.",
    severity: "info",
  },
  "10": {
    title: "Permission Required",
    message: "Please allow access to the App Store to proceed.",
    severity: "error",
  },
  "11": {
    title: "Already Subscribed",
    message: "You already have an active subscription. Try restoring your purchases.",
    severity: "info",
  },
  "12": {
    title: "Receipt Already Used",
    message: "This purchase receipt is associated with another account.",
    severity: "error",
  },
  "17": {
    title: "Network Error",
    message: "Couldn't connect to the App Store. Please check your connection and try again.",
    severity: "error",
  },
};

// ─── Network ──────────────────────────────────────────────────────────────────

export const NETWORK_MESSAGES = {
  OFFLINE: {
    title: "No Internet Connection",
    message: "You're not connected to the internet. Please check your connection.",
    severity: "error" as ErrorSeverity,
  },
  TIMEOUT: {
    title: "Request Timed Out",
    message: "The request took too long. Please try again.",
    severity: "error" as ErrorSeverity,
  },
  SERVER_ERROR: {
    title: "Service Unavailable",
    message: "Our servers are having trouble right now. Please try again in a moment.",
    severity: "error" as ErrorSeverity,
  },
  PARSE_ERROR: {
    title: "Unexpected Response",
    message: "We received an unexpected response from the server. Please try again.",
    severity: "error" as ErrorSeverity,
  },
  RATE_LIMITED: {
    title: "Too Many Requests",
    message: "You've sent too many requests. Please wait a moment and try again.",
    severity: "warning" as ErrorSeverity,
  },
};

// ─── AI ───────────────────────────────────────────────────────────────────────

export const AI_MESSAGES = {
  RATE_LIMIT: {
    title: "AI Assistant Busy",
    message: "The AI assistant is handling too many requests right now. Please try again in a moment.",
    severity: "warning" as ErrorSeverity,
  },
  TIMEOUT: {
    title: "Response Timed Out",
    message: "The AI took too long to respond. Please try your question again.",
    severity: "error" as ErrorSeverity,
  },
  CONTENT_POLICY: {
    title: "Message Couldn't Be Processed",
    message: "This message couldn't be processed. Please rephrase your question.",
    severity: "warning" as ErrorSeverity,
  },
  CONTEXT_EXCEEDED: {
    title: "Conversation Too Long",
    message: "The conversation is getting quite long. Starting a fresh chat may help.",
    severity: "info" as ErrorSeverity,
  },
  UNAVAILABLE: {
    title: "AI Assistant Unavailable",
    message: "The AI assistant is temporarily unavailable. Please try again later.",
    severity: "error" as ErrorSeverity,
  },
  STREAM_INTERRUPTED: {
    title: "Connection Interrupted",
    message: "The response was interrupted mid-way. Please try again.",
    severity: "error" as ErrorSeverity,
  },
  EMPTY_RESPONSE: {
    title: "No Response Received",
    message: "The AI didn't return a response. Please try again.",
    severity: "error" as ErrorSeverity,
  },
  HALLUCINATION_DISCLAIMER: "Note: AI responses may occasionally include estimates or general information. Always verify specific figures against your actual account data.",
};

// ─── Default ──────────────────────────────────────────────────────────────────

const DEFAULT_ERROR: MappedError = {
  title: "Something Went Wrong",
  message: "An unexpected error occurred. Please try again.",
  severity: "error",
};

// ─── Main mapper ──────────────────────────────────────────────────────────────

/**
 * Maps any known error (Firebase, Firestore, Plaid, RevenueCat, network) to a
 * user-friendly Canadian English MappedError. Falls back to a generic message.
 */
export function mapError(error: unknown): MappedError {
  if (!error) return DEFAULT_ERROR;

  const err = error as any;
  const code: string = err?.code ?? err?.errorCode ?? "";
  const message: string = (err?.message ?? "").toLowerCase();

  // Firebase Auth
  if (code && code in AUTH_MESSAGES) return AUTH_MESSAGES[code];

  // Firestore (code format: "firestore/permission-denied" or bare "permission-denied")
  const fsCode = code.replace(/^firestore\//, "");
  if (fsCode && fsCode in FIRESTORE_MESSAGES) return FIRESTORE_MESSAGES[fsCode];

  // Plaid error codes (from API response body)
  if (code && code in PLAID_MESSAGES) return PLAID_MESSAGES[code];

  // RevenueCat — numeric code as string
  const rcCodeStr = String(err?.code ?? "");
  if (rcCodeStr && rcCodeStr in RC_MESSAGES) return RC_MESSAGES[rcCodeStr];

  // RevenueCat — userCancelled flag
  if (err?.userCancelled === true) {
    return { title: "Purchase Cancelled", message: "The purchase was cancelled.", severity: "info" };
  }

  // HTTP status codes
  const status = err?.status ?? err?.statusCode ?? 0;
  if (status === 429) return NETWORK_MESSAGES.RATE_LIMITED;
  if (status === 500 || status === 503) return NETWORK_MESSAGES.SERVER_ERROR;

  // Network detection via message heuristics
  if (
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("network error") ||
    message.includes("no internet") ||
    message.includes("cannot connect") ||
    message.includes("net::err") ||
    message.includes("econnrefused") ||
    message.includes("enotfound")
  ) {
    return NETWORK_MESSAGES.OFFLINE;
  }

  if (message.includes("timeout") || message.includes("timed out") || message.includes("etimedout")) {
    return NETWORK_MESSAGES.TIMEOUT;
  }

  if (message.includes("500") || message.includes("503") || message.includes("server error")) {
    return NETWORK_MESSAGES.SERVER_ERROR;
  }

  return DEFAULT_ERROR;
}

/** Returns just the user-facing message string. */
export function getErrorMessage(error: unknown): string {
  return mapError(error).message;
}

/** Returns just the title string. */
export function getErrorTitle(error: unknown): string {
  return mapError(error).title;
}

/** Returns true if the error is a user-initiated cancellation (should not show an error). */
export function isCancelledByUser(error: unknown): boolean {
  const err = error as any;
  if (err?.userCancelled === true) return true;
  const code = err?.code ?? "";
  return (
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request" ||
    (err?.message ?? "").toLowerCase().includes("cancelled")
  );
}

/** Returns true if the error indicates the device is offline. */
export function isNetworkError(error: unknown): boolean {
  const mapped = mapError(error);
  return mapped === NETWORK_MESSAGES.OFFLINE || mapped === NETWORK_MESSAGES.TIMEOUT;
}
