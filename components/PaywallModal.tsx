import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import toast from "@/utils/toast";
import { mapError, isCancelledByUser } from "@/utils/errorMessages";

const C = Colors.dark;

const FEATURES = [
  { icon: "link-outline" as const, label: "Bank Sync with Plaid", desc: "Automatic transaction import" },
  { icon: "sparkles" as const, label: "AI Finance Coach", desc: "Unlimited conversations" },
  { icon: "trending-up-outline" as const, label: "Wealth Trajectory", desc: "Project your net worth" },
  { icon: "leaf-outline" as const, label: "Canadian Tax Intelligence", desc: "TFSA, RRSP, FHSA insights" },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubscribed: () => void;
}

export default function PaywallModal({ visible, onClose, onSubscribed }: Props) {
  const insets = useSafeAreaInsets();
  const [isAnnual, setIsAnnual] = useState(true);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [offerings, setOfferings] = useState<any>(null);
  const [noOfferings, setNoOfferings] = useState(false);
  const [success, setSuccess] = useState(false);
  const successScale = useRef(new Animated.Value(0)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;
  // Prevent double-tap purchase
  const purchaseInProgress = useRef(false);

  useEffect(() => {
    if (!visible) {
      setSuccess(false);
      setNoOfferings(false);
      purchaseInProgress.current = false;
      return;
    }
    (async () => {
      try {
        if (Platform.OS === "web") return;
        const Purchases = require("react-native-purchases").default;
        const o = await Purchases.getOfferings();
        if (o.current) {
          setOfferings(o.current);
          setNoOfferings(false);
        } else {
          setNoOfferings(true);
        }
      } catch {
        // Offerings load failure is non-blocking — we fall back to hardcoded prices
        setNoOfferings(false);
      }
    })();
  }, [visible]);

  const showSuccess = (afterClose: () => void) => {
    setSuccess(true);
    successScale.setValue(0);
    successOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(successScale, { toValue: 1, useNativeDriver: true, bounciness: 15 }),
      Animated.timing(successOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    setTimeout(() => {
      Animated.timing(successOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setSuccess(false);
        afterClose();
      });
    }, 1500);
  };

  const handleSubscribe = async () => {
    // Prevent double-tap
    if (purchaseInProgress.current || loading || restoring) return;

    if (Platform.OS === "web") {
      Alert.alert("Not Available", "Subscriptions are only available on iOS and Android.");
      return;
    }

    if (noOfferings) {
      toast.warning("No subscription packages are available right now. Please check the App Store or try again later.");
      return;
    }

    purchaseInProgress.current = true;
    setLoading(true);
    try {
      const Purchases = require("react-native-purchases").default;
      const pkg = isAnnual
        ? offerings?.annual ?? offerings?.availablePackages?.[0]
        : offerings?.monthly ?? offerings?.availablePackages?.[0];

      if (!pkg) {
        toast.warning("No subscription packages found. If you're in TestFlight, this is expected — packages load from the App Store in production.");
        return;
      }

      await Purchases.purchasePackage(pkg);
      showSuccess(() => { onSubscribed(); onClose(); });
    } catch (e: any) {
      if (isCancelledByUser(e)) return; // User backed out — no toast needed

      const mapped = mapError(e);
      // Payment declined or special states get a toast; other errors use Alert for prominence
      if (mapped.severity === "info") {
        toast.info(mapped.message);
      } else {
        Alert.alert(mapped.title, mapped.message);
      }
    } finally {
      setLoading(false);
      purchaseInProgress.current = false;
    }
  };

  const handleRestore = async () => {
    if (purchaseInProgress.current || loading || restoring) return;
    if (Platform.OS === "web") return;

    purchaseInProgress.current = true;
    setRestoring(true);
    try {
      const Purchases = require("react-native-purchases").default;
      const info = await Purchases.restorePurchases();
      const active = !!info.entitlements.active["monthly"];
      if (active) {
        showSuccess(() => { onSubscribed(); onClose(); });
      } else {
        Alert.alert(
          "No Subscription Found",
          "No active purchases were found for this Apple ID. If you subscribed on a different account, sign out of the App Store and try again.",
        );
      }
    } catch (err) {
      if (isCancelledByUser(err)) return;
      const mapped = mapError(err);
      Alert.alert(mapped.title, mapped.message);
    } finally {
      setRestoring(false);
      purchaseInProgress.current = false;
    }
  };

  // Hardcoded fallback prices (shown when offerings not loaded yet)
  const monthlyPrice = offerings?.monthly?.product?.priceString ?? "$14.99";
  const annualPrice = offerings?.annual?.product?.priceString ?? "$89.99";
  const annualMonthly = offerings?.annual?.product?.price
    ? `$${(offerings.annual.product.price / 12).toFixed(2)}/mo`
    : "$7.50/mo";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { paddingBottom: insets.bottom + 20 }]}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={C.textSecondary} />
          </Pressable>
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <LinearGradient colors={["#003D2A", "#001A12"]} style={styles.heroIcon}>
            <Ionicons name="leaf" size={36} color={C.tint} />
          </LinearGradient>
          <Text style={styles.heroTitle}>Thrive Pro</Text>
          <Text style={styles.heroSubtitle}>Your complete Canadian finance toolkit</Text>
        </View>

        {/* Features */}
        <View style={styles.featureList}>
          {FEATURES.map((f) => (
            <View key={f.label} style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Ionicons name={f.icon} size={18} color={C.tint} />
              </View>
              <View style={styles.featureText}>
                <Text style={styles.featureLabel}>{f.label}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
              <Ionicons name="checkmark-circle" size={18} color={C.tint} />
            </View>
          ))}
        </View>

        {/* Billing toggle */}
        <View style={styles.toggleRow}>
          <Pressable
            onPress={() => setIsAnnual(false)}
            style={[styles.toggleBtn, !isAnnual && styles.toggleBtnActive]}
          >
            <Text style={[styles.toggleText, !isAnnual && styles.toggleTextActive]}>
              Monthly{"\n"}{monthlyPrice}/mo
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setIsAnnual(true)}
            style={[styles.toggleBtn, isAnnual && styles.toggleBtnActive]}
          >
            <Text style={[styles.toggleText, isAnnual && styles.toggleTextActive]}>
              Annual{"\n"}{annualMonthly}
            </Text>
            {isAnnual && (
              <View style={styles.savingsBadge}>
                <Text style={styles.savingsBadgeText}>SAVE 50%</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Subscribe button */}
        <Pressable onPress={handleSubscribe} disabled={loading || restoring} style={styles.subscribeBtn}>
          {loading
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.subscribeBtnText}>
                Start Thrive Pro · {isAnnual ? annualPrice + "/yr" : monthlyPrice + "/mo"}
              </Text>}
        </Pressable>

        {/* Restore */}
        <Pressable onPress={handleRestore} disabled={loading || restoring} style={styles.restoreBtn}>
          {restoring
            ? <ActivityIndicator size="small" color={C.textMuted} />
            : <Text style={styles.restoreBtnText}>Restore Purchases</Text>}
        </Pressable>

        <Text style={styles.legalText}>
          Cancel anytime. Subscription renews automatically.
        </Text>

        {/* Success overlay */}
        {success && (
          <Animated.View style={[styles.successOverlay, { opacity: successOpacity }]}>
            <Animated.View style={[styles.successCircle, { transform: [{ scale: successScale }] }]}>
              <Ionicons name="checkmark" size={48} color="#000" />
            </Animated.View>
            <Text style={styles.successText}>Welcome to Pro!</Text>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, paddingHorizontal: 24, paddingTop: 8 },
  header: { flexDirection: "row", justifyContent: "flex-end", paddingBottom: 8 },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.elevated, alignItems: "center", justifyContent: "center",
  },
  hero: { alignItems: "center", gap: 10, paddingVertical: 20 },
  heroIcon: {
    width: 80, height: 80, borderRadius: 24,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: `${C.tint}30`,
  },
  heroTitle: { fontFamily: "DM_Sans_700Bold", fontSize: 28, color: C.text, letterSpacing: -0.5 },
  heroSubtitle: { fontFamily: "DM_Sans_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center" },
  featureList: { gap: 12, marginBottom: 24 },
  featureRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: C.card, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: 1, borderColor: C.border,
  },
  featureIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: `${C.tint}18`, alignItems: "center", justifyContent: "center",
  },
  featureText: { flex: 1 },
  featureLabel: { fontFamily: "DM_Sans_600SemiBold", fontSize: 14, color: C.text },
  featureDesc: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted },
  toggleRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  toggleBtn: {
    flex: 1, borderRadius: 14, padding: 14,
    alignItems: "center", backgroundColor: C.elevated,
    borderWidth: 1, borderColor: C.border,
  },
  toggleBtnActive: { borderColor: C.tint, backgroundColor: `${C.tint}12` },
  toggleText: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.textMuted, textAlign: "center", lineHeight: 20 },
  toggleTextActive: { color: C.tint },
  savingsBadge: {
    backgroundColor: C.tint, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2, marginTop: 4,
  },
  savingsBadgeText: { fontFamily: "DM_Sans_700Bold", fontSize: 9, color: "#000", letterSpacing: 0.5 },
  subscribeBtn: {
    backgroundColor: C.tint, borderRadius: 14,
    paddingVertical: 16, alignItems: "center",
    marginBottom: 12,
  },
  subscribeBtnText: { fontFamily: "DM_Sans_700Bold", fontSize: 16, color: "#000" },
  restoreBtn: { alignItems: "center", paddingVertical: 8, marginBottom: 8 },
  restoreBtnText: { fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textMuted },
  legalText: { fontFamily: "DM_Sans_400Regular", fontSize: 11, color: C.textMuted, textAlign: "center" },
  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: `${C.background}E8`,
    alignItems: "center", justifyContent: "center", gap: 16,
  },
  successCircle: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: C.tint, alignItems: "center", justifyContent: "center",
  },
  successText: { fontFamily: "DM_Sans_700Bold", fontSize: 22, color: C.text },
});
