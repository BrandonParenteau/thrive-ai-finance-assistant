/**
 * services/revenueCat.ts
 *
 * RevenueCat REST API v1 wrapper — zero native module dependency.
 *
 * All entitlement logic lives here. react-native-iap handles StoreKit
 * communication; this module validates receipts with RevenueCat and reads
 * subscriber state.
 *
 * Public API key (appl_*) is safe to ship in the client bundle.
 * Never use the secret key here.
 */

import { Platform } from "react-native";

// ─── Constants ────────────────────────────────────────────────────────────────

const RC_BASE = "https://api.revenuecat.com/v1";

/** The entitlement ID configured in the RevenueCat dashboard. */
const ENTITLEMENT_ID = "monthly";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RCSubscriberInfo {
  isPro: boolean;
  expiresDate: string | null;
  originalAppUserId: string;
}

export interface RCPackage {
  /** RevenueCat package identifier, e.g. "$rc_monthly", "$rc_annual" */
  identifier: string;
  /** App Store / Play Store product ID, e.g. "thrive_pro_monthly" */
  productId: string;
}

export interface ThriveOfferings {
  monthly?: ThrivePackage;
  annual?: ThrivePackage;
  availablePackages: ThrivePackage[];
}

export interface ThrivePackage extends RCPackage {
  /** Populated after react-native-iap fetches StoreKit prices. */
  priceString?: string;
  /** Numeric price in the user's currency (for per-month calculations). */
  price?: number;
}

// ─── Module-level state ───────────────────────────────────────────────────────

let _appUserId: string | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function apiKey(): string {
  return Platform.OS === "ios"
    ? (process.env.EXPO_PUBLIC_RC_IOS_KEY ?? "")
    : (process.env.EXPO_PUBLIC_RC_ANDROID_KEY ?? "");
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
    "Content-Type": "application/json",
    "X-Platform": Platform.OS === "ios" ? "ios" : "android",
  };
}

function parseSubscriber(data: any, fallbackUserId: string): RCSubscriberInfo {
  const subscriber = data?.subscriber;
  const ent = subscriber?.entitlements?.[ENTITLEMENT_ID];
  const isActive =
    ent != null &&
    (ent.expires_date == null || new Date(ent.expires_date) > new Date());
  return {
    isPro: isActive,
    expiresDate: ent?.expires_date ?? null,
    originalAppUserId: subscriber?.original_app_user_id ?? fallbackUserId,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** No-op — kept for call-site symmetry with the old Purchases.configure(). */
export function initializeRevenueCat(): void {
  // Nothing to initialise — no native module.
}

/** Store the authenticated user ID for subsequent calls. */
export function setAppUserId(userId: string): void {
  _appUserId = userId;
}

export function getAppUserId(): string | null {
  return _appUserId;
}

/**
 * GET /v1/subscribers/{app_user_id}
 * Returns subscriber entitlement status.
 */
export async function getCustomerInfo(
  appUserId: string,
): Promise<RCSubscriberInfo> {
  const res = await fetch(
    `${RC_BASE}/subscribers/${encodeURIComponent(appUserId)}`,
    { headers: headers() },
  );
  if (!res.ok) {
    throw new Error(`[RevenueCat] getCustomerInfo: HTTP ${res.status}`);
  }
  return parseSubscriber(await res.json(), appUserId);
}

/**
 * GET /v1/subscribers/{app_user_id}/offerings
 * Returns the current offering's packages keyed by billing period.
 * Prices are NOT included — call iapService.enrichOfferingsWithPrices() to
 * merge StoreKit pricing into the returned packages.
 */
export async function getOfferings(
  appUserId: string,
): Promise<ThriveOfferings> {
  const res = await fetch(
    `${RC_BASE}/subscribers/${encodeURIComponent(appUserId)}/offerings`,
    { headers: headers() },
  );
  if (!res.ok) {
    throw new Error(`[RevenueCat] getOfferings: HTTP ${res.status}`);
  }

  const data = await res.json();
  const currentId: string = data.current_offering_id;
  const offering =
    (data.offerings as any[])?.find((o) => o.identifier === currentId) ??
    data.offerings?.[0];

  if (!offering) return { availablePackages: [] };

  const packages: ThrivePackage[] = (offering.packages as any[]).map((p) => ({
    identifier: p.identifier as string,
    productId: (p.platform_product_identifier ?? p.store_product_identifier) as string,
  }));

  const monthly = packages.find(
    (p) =>
      p.identifier === "$rc_monthly" ||
      p.identifier.toLowerCase().includes("monthly"),
  );
  const annual = packages.find(
    (p) =>
      p.identifier === "$rc_annual" ||
      p.identifier.toLowerCase().includes("annual"),
  );

  return { monthly, annual, availablePackages: packages };
}

/**
 * POST /v1/receipts
 * Validates an App Store / Play Store receipt with RevenueCat and returns
 * updated subscriber entitlement status.
 *
 * @param receiptData  Base-64 encoded App Store receipt (iOS) or purchase
 *                     token (Android).
 * @param productId    Store product identifier for the purchased item.
 * @param isRestore    Set to true when restoring prior purchases.
 */
export async function postReceipt(
  appUserId: string,
  receiptData: string,
  productId: string,
  isRestore = false,
): Promise<RCSubscriberInfo> {
  const res = await fetch(`${RC_BASE}/receipts`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      app_user_id: appUserId,
      fetch_token: receiptData,
      product_id: productId,
      is_restore: isRestore,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`[RevenueCat] postReceipt: HTTP ${res.status} — ${body}`);
  }
  return parseSubscriber(await res.json(), appUserId);
}

/**
 * Convenience: returns true if the subscriber has an active Pro entitlement.
 * Returns false (rather than throwing) on network failures — the app should
 * default to the free tier rather than gate-crashing.
 */
export async function isProUser(appUserId: string): Promise<boolean> {
  try {
    const info = await getCustomerInfo(appUserId);
    return info.isPro;
  } catch {
    return false;
  }
}
