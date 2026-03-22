import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";

const C = Colors.dark;

interface Props {
  children: React.ReactNode;
  locked: boolean;
  title?: string;
  subtitle?: string;
  onUnlock: () => void;
}

export default function LockedFeature({ children, locked, title = "Pro Feature", subtitle = "Upgrade to Thrive Pro to unlock", onUnlock }: Props) {
  if (!locked) return <>{children}</>;

  return (
    <View style={styles.wrapper}>
      <View style={styles.childrenContainer} pointerEvents="none">
        {children}
      </View>
      <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFill}>
        <Pressable style={styles.overlay} onPress={onUnlock}>
          <View style={styles.card}>
            <View style={styles.lockIcon}>
              <Ionicons name="lock-closed" size={24} color={C.tint} />
            </View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
            <View style={styles.upgradeBtn}>
              <Ionicons name="sparkles" size={14} color="#000" />
              <Text style={styles.upgradeBtnText}>Upgrade to Pro</Text>
            </View>
          </View>
        </Pressable>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: "relative" },
  childrenContainer: { opacity: 0.3 },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    backgroundColor: C.card, borderRadius: 20,
    padding: 24, alignItems: "center", gap: 10,
    borderWidth: 1, borderColor: `${C.tint}30`,
    maxWidth: 300, width: "100%",
  },
  lockIcon: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: `${C.tint}18`, alignItems: "center", justifyContent: "center",
  },
  title: { fontFamily: "DM_Sans_700Bold", fontSize: 18, color: C.text, textAlign: "center" },
  subtitle: { fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textSecondary, textAlign: "center" },
  upgradeBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.tint, borderRadius: 12,
    paddingHorizontal: 18, paddingVertical: 10, marginTop: 4,
  },
  upgradeBtnText: { fontFamily: "DM_Sans_700Bold", fontSize: 14, color: "#000" },
});
