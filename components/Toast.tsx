import React, { useState, useCallback, useEffect } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { registerToastHandler, ToastMessage, ToastType } from "@/utils/toast";

const ICON: Record<ToastType, keyof typeof Ionicons.glyphMap> = {
  error: "alert-circle",
  warning: "warning",
  success: "checkmark-circle",
  info: "information-circle",
};

const COLOR: Record<ToastType, string> = {
  error: "#FF5252",
  warning: "#F5C842",
  success: "#00D4A0",
  info: "#56CFE1",
};

function ToastItem({ toast }: { toast: ToastMessage }) {
  const color = COLOR[toast.type];
  return (
    <Animated.View
      entering={FadeInDown.duration(260).springify()}
      exiting={FadeOutDown.duration(220)}
      style={[styles.toast, { borderLeftColor: color }]}
    >
      <Ionicons name={ICON[toast.type]} size={18} color={color} style={styles.icon} />
      <Text style={styles.message} numberOfLines={3}>{toast.message}</Text>
    </Animated.View>
  );
}

/**
 * Render once at the app root. Picks up toasts fired via `toast.error(...)` etc.
 */
export function ToastContainer() {
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((t: ToastMessage) => {
    setToasts((prev) => [...prev.slice(-2), t]); // cap at 3 visible
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== t.id));
    }, t.duration);
  }, []);

  useEffect(() => {
    registerToastHandler(addToast);
  }, [addToast]);

  if (toasts.length === 0) return null;

  // Sit above the tab bar on mobile, above the bottom edge on web
  const bottom = Platform.OS === "web"
    ? Math.max(insets.bottom, 24) + 72
    : insets.bottom + 90;

  return (
    <View style={[styles.container, { bottom }]} pointerEvents="none">
      {toasts.map((t) => <ToastItem key={t.id} toast={t} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 9999,
    gap: 8,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#132018",
    borderRadius: 12,
    borderLeftWidth: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  icon: { flexShrink: 0 },
  message: {
    flex: 1,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 14,
    color: "#F0F7F2",
    lineHeight: 20,
  },
});
