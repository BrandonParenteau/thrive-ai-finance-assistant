import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const C = Colors.dark;

export default function IncomeScreen() {
  const insets = useSafeAreaInsets();
  const { updateProfile } = useAuth();
  const [income, setIncome] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const topPad = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;
  const bottomPad = Platform.OS === "web" ? Math.max(insets.bottom, 34) : insets.bottom;

  const handleNext = async () => {
    const val = parseFloat(income.replace(/,/g, ""));
    if (!income || isNaN(val) || val <= 0) {
      setError("Please enter a valid monthly income");
      return;
    }
    setLoading(true);
    try {
      await updateProfile({ monthly_income: val });
      router.push("/onboarding/categories");
    } catch (err: any) {
      setError(err.message || "Failed to save income");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 24, paddingBottom: bottomPad + 32 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.progressRow}>
        <View style={[styles.dot, styles.dotActive]} />
        <View style={styles.dot} />
        <View style={styles.dot} />
      </View>

      <Ionicons name="cash-outline" size={48} color={C.tint} style={{ marginBottom: 20 }} />

      <Text style={styles.title}>What's your monthly income?</Text>
      <Text style={styles.subtitle}>
        This helps us set realistic budgets and savings goals tailored to you.
      </Text>

      <View style={styles.inputGroup}>
        <Text style={styles.currencyLabel}>CAD</Text>
        <View style={styles.inputWrap}>
          <Text style={styles.currencySymbol}>$</Text>
          <TextInput
            style={styles.input}
            value={income}
            onChangeText={(v) => { setIncome(v); setError(""); }}
            placeholder="0.00"
            placeholderTextColor={C.textMuted}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={handleNext}
            autoFocus
          />
        </View>
        <Text style={styles.hint}>Net monthly income (after tax)</Text>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.examples}>
        {["4,000", "5,500", "7,000", "10,000"].map((v) => (
          <Pressable
            key={v}
            style={styles.exampleChip}
            onPress={() => { setIncome(v.replace(",", "")); setError(""); }}
          >
            <Text style={styles.exampleText}>${v}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[styles.nextBtn, (!income || loading) && styles.nextBtnDisabled]}
        onPress={handleNext}
        disabled={!income || loading}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  content: { paddingHorizontal: 24, alignItems: "flex-start" },
  progressRow: { flexDirection: "row", gap: 6, marginBottom: 40, alignSelf: "flex-start" },
  dot: { width: 28, height: 4, borderRadius: 2, backgroundColor: C.border },
  dotActive: { backgroundColor: C.tint },
  title: { fontFamily: "DM_Sans_700Bold", fontSize: 28, color: C.text, marginBottom: 10, lineHeight: 36 },
  subtitle: { fontFamily: "DM_Sans_400Regular", fontSize: 15, color: C.textSecondary, lineHeight: 24, marginBottom: 36, width: "100%" },
  inputGroup: { width: "100%", gap: 8, marginBottom: 12 },
  currencyLabel: { fontFamily: "DM_Sans_500Medium", fontSize: 12, color: C.textMuted, textTransform: "uppercase", letterSpacing: 1 },
  inputWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.card, borderRadius: 16,
    borderWidth: 2, borderColor: C.tint,
    paddingHorizontal: 18,
  },
  currencySymbol: { fontFamily: "DM_Sans_700Bold", fontSize: 28, color: C.textSecondary, marginRight: 4 },
  input: { flex: 1, fontFamily: "DM_Sans_700Bold", fontSize: 32, color: C.text, paddingVertical: 16 },
  hint: { fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textMuted },
  errorText: { fontFamily: "DM_Sans_400Regular", fontSize: 13, color: "#FF5252", backgroundColor: "#FF525218", padding: 12, borderRadius: 10, width: "100%", marginBottom: 12 },
  examples: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 40, width: "100%" },
  exampleChip: {
    backgroundColor: C.card, borderRadius: 10,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  exampleText: { fontFamily: "DM_Sans_500Medium", fontSize: 14, color: C.textSecondary },
  nextBtn: {
    width: "100%", backgroundColor: C.tint, borderRadius: 14,
    paddingVertical: 16, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 8,
  },
  nextBtnDisabled: { opacity: 0.4 },
  nextBtnText: { fontFamily: "DM_Sans_600SemiBold", fontSize: 16, color: "#000" },
});
