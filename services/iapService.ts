/**
 * services/iapService.ts
 *
 * react-native-iap wrapper for StoreKit (iOS) and Google Play (Android).
 *
 * Responsibilities:
 *  1. Open/close the StoreKit connection (initIAP / teardownIAP).
 *  2. Fetch product details (prices, titles) from the store.
 *  3. Initiate purchases and listen for results.
 *  4. On successful purchase/restore, post the receipt to RevenueCat and
 *     call the onSuccess callback with the updated isPro flag.
 *  5. Enrich RevenueCat offering packages with StoreKit prices.
 *
 * Purchase flow:
 *   purchaseSubscription(sku)
 *     → StoreKit transaction
 *     → purchaseUpdatedListener fires
 *     → getReceiptIOS() / purchaseToken
 *     → revenueCat.postReceipt()
 *     → finishTransaction()
 *     → onSuccess(isPro)
 */

import { Platform } from "react-native";
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  getAvailablePurchases,
  purchaseUpdatedListener,
  purchaseErrorListener,
  finishTransaction,
  getReceiptIOS,
  type Purchase,
  type PurchaseError,
  type EventSubscription,
} from "react-native-iap";
import { postReceipt, type ThriveOfferings, type ThrivePackage } from "./revenueCat";

// ─── Module-level state ───────────────────────────────────────────────────────

let _purchaseListener: EventSubscription | null = null;
let _errorListener: EventSubscription | null = null;
let _appUserId: string | null = null;
let _onSuccess: ((isPro: boolean) => void) | null = null;
let _onError: ((err: PurchaseError) => void) | null = null;
let _connected = false;

// ─── Connection ───────────────────────────────────────────────────────────────

/**
 * Opens the StoreKit / Play Billing connection.
 * Safe to call multiple times — no-ops if already connected.
 */
export async function initIAP(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  if (_connected) return true;
  try {
    await initConnection();
    _connected = true;
    return true;
  } catch (err) {
    console.warn("[IAP] initConnection failed:", err);
    return false;
  }
}

export async function teardownIAP(): Promise<void> {
  removePurchaseListeners();
  if (_connected) {
    try {
      await endConnection();
    } catch {}
    _connected = false;
  }
}

// ─── Purchase listeners ───────────────────────────────────────────────────────

/**
 * Register app-level purchase event handlers. Call once after initIAP().
 *
 * @param appUserId  Authenticated user ID — used for RevenueCat receipt posting.
 * @param onSuccess  Fires after RevenueCat confirms the receipt. isPro = true
 *                   means the entitlement is now active.
 * @param onError    Fires on StoreKit purchase errors (e.g. user cancelled).
 */
export function setupPurchaseListeners(
  appUserId: string,
  onSuccess: (isPro: boolean) => void,
  onError: (err: PurchaseError) => void,
): void {
  _appUserId = appUserId;
  _onSuccess = onSuccess;
  _onError = onError;

  // Remove any previously registered listeners before re-registering.
  removePurchaseListeners();

  _purchaseListener = purchaseUpdatedListener(async (purchase: Purchase) => {
    try {
      const receipt =
        Platform.OS === "ios"
          ? await getReceiptIOS()
          : (purchase.purchaseToken ?? "");

      if (!receipt || !_appUserId) {
        console.warn("[IAP] purchaseUpdated: no receipt or appUserId — skipping");
        return;
      }

      const info = await postReceipt(
        _appUserId,
        receipt,
        purchase.productId,
        false,
      );

      // Always acknowledge the transaction, even if RC returns isPro=false.
      try {
        await finishTransaction({ purchase, isConsumable: false });
      } catch (finishErr) {
        console.warn("[IAP] finishTransaction failed:", finishErr);
      }

      _onSuccess?.(info.isPro);
    } catch (err) {
      console.error("[IAP] purchaseUpdatedListener error:", err);
      // Finish the transaction anyway to prevent it re-appearing on next launch.
      try {
        await finishTransaction({ purchase, isConsumable: false });
      } catch {}
    }
  });

  _errorListener = purchaseErrorListener((err: PurchaseError) => {
    _onError?.(err);
  });
}

export function removePurchaseListeners(): void {
  _purchaseListener?.remove();
  _errorListener?.remove();
  _purchaseListener = null;
  _errorListener = null;
}

// ─── Products ─────────────────────────────────────────────────────────────────

/**
 * Fetch subscription product details (price, title, description) from StoreKit.
 * Returns an empty array on web or when no SKUs are provided.
 */
export async function getSubscriptionProducts(skus: string[]): Promise<
  { productId: string; priceString: string; price: number }[]
> {
  if (Platform.OS === "web" || !skus.length) return [];
  try {
    const products = await fetchProducts({ skus, type: "subs" });
    if (!products) return [];
    return products.map((p) => ({
      productId: p.id,
      priceString: p.displayPrice,
      price: Number(p.price ?? 0),
    }));
  } catch (err) {
    console.warn("[IAP] getSubscriptionProducts failed:", err);
    return [];
  }
}

/**
 * Merge StoreKit prices into a RevenueCat offerings object.
 * Returns the offerings unchanged when on web or when StoreKit is unavailable.
 */
export async function enrichOfferingsWithPrices(
  offerings: ThriveOfferings,
): Promise<ThriveOfferings> {
  const skus = offerings.availablePackages
    .map((p) => p.productId)
    .filter(Boolean);

  if (!skus.length) return offerings;

  const products = await getSubscriptionProducts(skus);
  const priceMap = new Map(products.map((p) => [p.productId, p]));

  const enrich = (pkg: ThrivePackage | undefined): ThrivePackage | undefined => {
    if (!pkg) return undefined;
    const storeProduct = priceMap.get(pkg.productId);
    return storeProduct
      ? { ...pkg, priceString: storeProduct.priceString, price: storeProduct.price }
      : pkg;
  };

  return {
    monthly: enrich(offerings.monthly),
    annual: enrich(offerings.annual),
    availablePackages: offerings.availablePackages.map((p) => enrich(p)!),
  };
}

// ─── Purchase ─────────────────────────────────────────────────────────────────

/**
 * Initiates a subscription purchase through StoreKit / Google Play.
 * The actual receipt validation and onSuccess callback happen asynchronously
 * in the purchaseUpdatedListener registered by setupPurchaseListeners().
 */
export async function purchaseSubscription(sku: string): Promise<void> {
  await requestPurchase({
    request:
      Platform.OS === "ios"
        ? { apple: { sku } }
        : { google: { skus: [sku] } },
    type: "subs",
  });
}

// ─── Restore ─────────────────────────────────────────────────────────────────

/**
 * Restores prior purchases by fetching all available transactions and posting
 * each to RevenueCat with is_restore=true.
 *
 * @returns true if at least one restored purchase activated the Pro entitlement.
 */
export async function restoreAndValidate(appUserId: string): Promise<boolean> {
  if (Platform.OS === "web") return false;

  const purchases = await getAvailablePurchases();
  if (!purchases.length) return false;

  // On iOS we get one app-store-wide receipt that covers all transactions.
  const iosReceipt = Platform.OS === "ios" ? await getReceiptIOS().catch(() => null) : null;

  let isPro = false;
  for (const purchase of purchases) {
    try {
      const token =
        Platform.OS === "ios"
          ? (iosReceipt ?? "")
          : (purchase.purchaseToken ?? "");
      if (!token) continue;

      const info = await postReceipt(appUserId, token, purchase.productId, true);
      if (info.isPro) isPro = true;

      try {
        await finishTransaction({ purchase, isConsumable: false });
      } catch {}
    } catch (err) {
      console.warn("[IAP] restoreAndValidate: failed for", purchase.productId, err);
    }
  }
  return isPro;
}
