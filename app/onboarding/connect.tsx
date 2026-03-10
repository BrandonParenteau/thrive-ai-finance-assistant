import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  ScrollView,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useAuth } from "@/context/AuthContext";
import { useFinance } from "@/context/FinanceContext";
import { getFunctionsUrl } from "@/lib/functions";
import Colors from "@/constants/colors";

const C = Colors.dark;

export default function ConnectScreen() {
  const insets = useSafeAreaInsets();
  const { token, updateProfile } = useAuth();
  const { refreshAccounts } = useFinance();
  const [connecting, setConnecting] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const topPad = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;
  const bottomPad = Platform.OS === "web" ? Math.max(insets.bottom, 34) : insets.bottom;

  const handleConnectPlaid = async () => {
    setConnecting(true);
    try {
      const base = getFunctionsUrl();
      const resp = await fetch(`${base}/plaidLinkToken`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await resp.json();
      if (!resp.ok) {
        Alert.alert("Error", data.error || "Could not start Plaid connection.");
        return;
      }
      await WebBrowser.openBrowserAsync(`${base}/plaidLink?session=${encodeURIComponent(data.session_token)}`);
      await refreshAccounts();
    } catch (err: any) {
      Alert.alert("Connection Failed", err.message || "Unable to connect to Plaid. Please try again.");
    } finally {
      setConnecting(false);
    }
  };

  const handleFinish = async () => {
    setFinishing(true);
    try {
      await updateProfile({ onboarding_complete: true });
    } catch (err) {
      console.error("Failed to complete onboarding:", err);
    } finally {
      setFinishing(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: topPad + 24, paddingBottom: bottomPad + 24 }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.progressRow}>
          <View style={styles.dot} />
          <View style={styles.dot} />
          <View style={[styles.dot, styles.dotActive]} />
        </View>

        <Ionicons name="business-outline" size={48} color={C.tint} style={{ marginBottom: 20 }} />

        <Text style={styles.title}>Connect your accounts</Text>
        <Text style={styles.subtitle}>
          Securely link your bank and investment accounts to automatically import transactions and balances.
        </Text>

        <View style={styles.featureList}>
          {[
            { icon: "shield-checkmark-outline" as const, text: "Bank-level 256-bit encryption" },
            { icon: "eye-off-outline" as const, text: "Read-only access, we can never move money" },
            { icon: "flag-outline" as const, text: "All major Canadian banks supported" },
          ].map((f, i) => (
            <View key={i} style={styles.feature}>
              <View style={styles.featureIcon}>
                <Ionicons name={f.icon} size={18} color={C.tint} />
              </View>
              <Text style={styles.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.poweredBy}>Powered by Plaid — trusted by millions</Text>

        <Pressable
          style={[styles.plaidBtn, connecting && styles.btnDisabled]}
          onPress={handleConnectPlaid}
          disabled={connecting}
        >
          {connecting ? (
            <ActivityIndicator color="#000" />
          ) : (
            <>
              <Ionicons name="link-outline" size={20} color="#000" />
              <Text style={styles.plaidBtnText}>Connect Bank Account</Text>
            </>
          )}
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.skipBtn, finishing && styles.btnDisabled]}
          onPress={handleFinish}
          disabled={finishing}
        >
          {finishing ? (
            <ActivityIndicator color={C.tint} />
          ) : (
            <Text style={styles.skipText}>Skip for now</Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.doneBtn, finishing && styles.btnDisabled]}
          onPress={handleFinish}
          disabled={finishing}
        >
          {finishing ? (
            <ActivityIndicator color="#000" />
          ) : (
            <>
              <Text style={styles.doneBtnText}>Go to Thrive</Text>
              <Ionicons name="arrow-forward" size={18} color="#000" />
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, paddingHorizontal: 24 },
  content: { flexGrow: 1 },
  progressRow: { flexDirection: "row", gap: 6, marginBottom: 40 },
  dot: { width: 28, height: 4, borderRadius: 2, backgroundColor: C.border },
  dotActive: { backgroundColor: C.tint },
  title: { fontFamily: "DM_Sans_700Bold", fontSize: 28, color: C.text, marginBottom: 10, lineHeight: 36 },
  subtitle: { fontFamily: "DM_Sans_400Regular", fontSize: 15, color: C.textSecondary, lineHeight: 24, marginBottom: 28 },
  featureList: { gap: 16, marginBottom: 24 },
  feature: { flexDirection: "row", alignItems: "center", gap: 14 },
  featureIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: `${C.tint}18`, alignItems: "center", justifyContent: "center",
  },
  featureText: { fontFamily: "DM_Sans_400Regular", fontSize: 14, color: C.textSecondary, flex: 1 },
  poweredBy: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted, marginBottom: 28, textAlign: "center" },
  plaidBtn: {
    backgroundColor: C.tint, borderRadius: 14,
    paddingVertical: 16, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 10, marginBottom: 12,
  },
  plaidBtnText: { fontFamily: "DM_Sans_600SemiBold", fontSize: 16, color: "#000" },
  btnDisabled: { opacity: 0.5 },
  footer: { gap: 10, paddingTop: 8 },
  skipBtn: { alignItems: "center", paddingVertical: 12 },
  skipText: { fontFamily: "DM_Sans_500Medium", fontSize: 14, color: C.textMuted },
  doneBtn: {
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  doneBtnText: { fontFamily: "DM_Sans_600SemiBold", fontSize: 16, color: C.text },
});