import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { useFinance } from "@/context/FinanceContext";

const C = Colors.dark;

const ALL_CATEGORIES = [
  { name: "Groceries", icon: "cart-outline" as const, defaultLimit: 600 },
  { name: "Dining", icon: "restaurant-outline" as const, defaultLimit: 300 },
  { name: "Transport", icon: "car-outline" as const, defaultLimit: 250 },
  { name: "Entertainment", icon: "film-outline" as const, defaultLimit: 150 },
  { name: "Shopping", icon: "bag-outline" as const, defaultLimit: 200 },
  { name: "Utilities", icon: "flash-outline" as const, defaultLimit: 200 },
  { name: "Health", icon: "medkit-outline" as const, defaultLimit: 100 },
  { name: "Housing", icon: "home-outline" as const, defaultLimit: 2000 },
  { name: "Travel", icon: "airplane-outline" as const, defaultLimit: 300 },
  { name: "Personal Care", icon: "sparkles-outline" as const, defaultLimit: 100 },
  { name: "Subscriptions", icon: "refresh-circle-outline" as const, defaultLimit: 100 },
  { name: "Savings", icon: "wallet-outline" as const, defaultLimit: 500 },
];

export default function CategoriesScreen() {
  const insets = useSafeAreaInsets();
  const { setBudgets } = useFinance();
  const [selected, setSelected] = useState<Set<string>>(
    new Set(["Groceries", "Dining", "Transport", "Entertainment", "Shopping", "Utilities", "Health"])
  );
  const [loading, setLoading] = useState(false);

  const topPad = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;
  const bottomPad = Platform.OS === "web" ? Math.max(insets.bottom, 34) : insets.bottom;

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleNext = async () => {
    setLoading(true);
    try {
      const budgets = ALL_CATEGORIES
        .filter((c) => selected.has(c.name))
        .map((c) => ({ category: c.name, limit: c.defaultLimit, spent: 0 }));
      await setBudgets(budgets);
      router.push("/onboarding/connect");
    } catch (err) {
      console.error("Failed to save categories:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: topPad + 24 }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 100 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.progressRow}>
          <View style={styles.dot} />
          <View style={[styles.dot, styles.dotActive]} />
          <View style={styles.dot} />
        </View>

        <Ionicons name="pie-chart-outline" size={48} color={C.gold} style={{ marginBottom: 20 }} />

        <Text style={styles.title}>Pick your budget categories</Text>
        <Text style={styles.subtitle}>
          Select the categories you spend money on. You can edit limits anytime on the Insights page.
        </Text>

        <View style={styles.grid}>
          {ALL_CATEGORIES.map((cat) => {
            const isSelected = selected.has(cat.name);
            return (
              <Pressable
                key={cat.name}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => toggle(cat.name)}
              >
                <Ionicons
                  name={cat.icon}
                  size={20}
                  color={isSelected ? "#000" : C.textSecondary}
                />
                <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                  {cat.name}
                </Text>
                {isSelected && (
                  <Ionicons name="checkmark-circle" size={14} color="#000" />
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomPad + 16 }]}>
        <Text style={styles.selectedCount}>{selected.size} categories selected</Text>
        <Pressable
          style={[styles.nextBtn, (selected.size === 0 || loading) && styles.nextBtnDisabled]}
          onPress={handleNext}
          disabled={selected.size === 0 || loading}
        >
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <>
              <Text style={styles.nextBtnText}>Continue</Text>
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
  content: { alignItems: "flex-start" },
  progressRow: { flexDirection: "row", gap: 6, marginBottom: 40 },
  dot: { width: 28, height: 4, borderRadius: 2, backgroundColor: C.border },
  dotActive: { backgroundColor: C.gold },
  title: { fontFamily: "DM_Sans_700Bold", fontSize: 28, color: C.text, marginBottom: 10, lineHeight: 36 },
  subtitle: { fontFamily: "DM_Sans_400Regular", fontSize: 15, color: C.textSecondary, lineHeight: 24, marginBottom: 28, width: "100%" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, width: "100%" },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.card, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  chipSelected: { backgroundColor: C.tint, borderColor: C.tint },
  chipText: { fontFamily: "DM_Sans_500Medium", fontSize: 14, color: C.textSecondary },
  chipTextSelected: { color: "#000" },
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 24, paddingTop: 16,
    backgroundColor: C.background,
    borderTopWidth: 1, borderTopColor: C.border,
    gap: 12,
  },
  selectedCount: { fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textMuted, textAlign: "center" },
  nextBtn: {
    backgroundColor: C.tint, borderRadius: 14,
    paddingVertical: 16, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 8,
  },
  nextBtnDisabled: { opacity: 0.4 },
  nextBtnText: { fontFamily: "DM_Sans_600SemiBold", fontSize: 16, color: "#000" },
});
