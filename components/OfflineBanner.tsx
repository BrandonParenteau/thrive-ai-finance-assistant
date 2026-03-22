import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

/**
 * Persistent banner that appears at the very top of the screen whenever
 * the device has no internet connection. Render once at the app root.
 */
export function OfflineBanner() {
  const { isOnline } = useNetworkStatus();
  if (isOnline) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(300)}
      style={styles.banner}
      pointerEvents="none"
    >
      <View style={styles.inner}>
        <Ionicons name="cloud-offline-outline" size={15} color="#fff" />
        <Text style={styles.text}>No internet connection — working offline</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9998,
    backgroundColor: "#1A2E22",
    borderBottomWidth: 1,
    borderBottomColor: "#2D4E3A",
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  text: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 12,
    color: "#8DB89A",
    letterSpacing: 0.1,
  },
});
