/**
 * BudgetAlertsModal
 *
 * Lets users create per-category threshold alerts. When the app comes to the
 * foreground (via AppState in _layout.tsx) spending for each category is
 * compared against the threshold and a local notification fires if exceeded.
 *
 * Rules are stored in Firestore: users/{uid}/budgetAlerts/{alertId}
 * Shape: { id, category, threshold, lastFiredDate? }
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Keyboard,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useFinance } from "@/context/FinanceContext";
import Colors from "@/constants/colors";

const C = Colors.dark;

export interface BudgetAlert {
  id: string;
  category: string;
  threshold: number;
  lastFiredDate?: string;
}

const PRESET_CATEGORIES = [
  "Food & Dining",
  "Groceries",
  "Transport",
  "Entertainment",
  "Shopping",
  "Utilities",
  "Health",
  "Subscriptions",
  "Other",
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function BudgetAlertsModal({ visible, onClose }: Props) {
  const { user } = useAuth();
  const { transactions } = useFinance();

  const [alerts, setAlerts] = useState<BudgetAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // New alert form
  const [category, setCategory] = useState(PRESET_CATEGORIES[0]);
  const [customCategory, setCustomCategory] = useState("");
  const [threshold, setThreshold] = useState("");
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [formError, setFormError] = useState("");

  const alertsRef = useCallback(() => {
    if (!user) return null;
    return collection(db, "users", user.id, "budgetAlerts");
  }, [user]);

  // Load existing alerts
  useEffect(() => {
    if (!visible || !user) return;
    setLoading(true);
    getDocs(collection(db, "users", user.id, "budgetAlerts"))
      .then((snap) => {
        setAlerts(
          snap.docs.map((d) => {
            const data = d.data() as Record<string, any>;
            return {
              id: d.id,
              category: data.category ?? "Other",
              threshold: Number(data.threshold) || 0,
              lastFiredDate: data.lastFiredDate ?? undefined,
            };
          })
        );
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [visible, user]);

  const resolvedCategory = category === "Custom" ? customCategory.trim() : category;

  const handleAdd = async () => {
    setFormError("");
    if (!resolvedCategory) {
      setFormError("Please enter a category name.");
      return;
    }
    const t = parseFloat(threshold);
    if (isNaN(t) || t <= 0) {
      setFormError("Please enter a valid threshold amount.");
      return;
    }
    if (!user) return;
    setSaving(true);
    try {
      const ref = alertsRef();
      if (!ref) return;
      const data = { category: resolvedCategory, threshold: t };
      const docRef = await addDoc(ref, data);
      setAlerts((prev) => [...prev, { ...data, id: docRef.id }]);
      setThreshold("");
      setCustomCategory("");
      setCategory(PRESET_CATEGORIES[0]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setFormError("Failed to save alert. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (alertId: string, alertCategory: string) => {
    Alert.alert(
      `Remove Alert`,
      `Remove the ${alertCategory} spending alert?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            if (!user) return;
            try {
              await deleteDoc(doc(db, "users", user.id, "budgetAlerts", alertId));
              setAlerts((prev) => prev.filter((a) => a.id !== alertId));
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            } catch {
              Alert.alert("Error", "Failed to remove alert.");
            }
          },
        },
      ]
    );
  };

  // Current month spending per category
  const now = new Date();
  const spendingMap: Record<string, number> = {};
  transactions.forEach((t) => {
    const d = new Date(t.date);
    if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && t.amount < 0) {
      spendingMap[t.category] = (spendingMap[t.category] ?? 0) + Math.abs(t.amount);
    }
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Done</Text>
          </Pressable>
          <Text style={styles.title}>Budget Alerts</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={Keyboard.dismiss}
        >
          <Text style={styles.desc}>
            Get notified when your spending in a category exceeds your set threshold for the month.
          </Text>

          {/* Add new alert */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Add Alert</Text>

            {/* Category picker */}
            <Text style={styles.fieldLabel}>Category</Text>
            <Pressable
              style={styles.picker}
              onPress={() => setShowCategoryPicker((v) => !v)}
            >
              <Text style={styles.pickerText}>{category}</Text>
              <Ionicons
                name={showCategoryPicker ? "chevron-up" : "chevron-down"}
                size={16}
                color={C.textMuted}
              />
            </Pressable>

            {showCategoryPicker && (
              <View style={styles.dropdownList}>
                {[...PRESET_CATEGORIES, "Custom"].map((c) => (
                  <Pressable
                    key={c}
                    style={[styles.dropdownItem, category === c && styles.dropdownItemSelected]}
                    onPress={() => {
                      setCategory(c);
                      setShowCategoryPicker(false);
                    }}
                  >
                    <Text style={[styles.dropdownText, category === c && { color: C.tint }]}>{c}</Text>
                    {category === c && <Ionicons name="checkmark" size={14} color={C.tint} />}
                  </Pressable>
                ))}
              </View>
            )}

            {category === "Custom" && (
              <TextInput
                style={[styles.input, { marginTop: 8 }]}
                value={customCategory}
                onChangeText={setCustomCategory}
                placeholder="Enter category name"
                placeholderTextColor={C.textMuted}
              />
            )}

            {/* Threshold */}
            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Monthly Spending Limit</Text>
            <View style={styles.amountRow}>
              <Text style={styles.dollarSign}>$</Text>
              <TextInput
                style={styles.amountInput}
                value={threshold}
                onChangeText={setThreshold}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={C.textMuted}
              />
            </View>

            {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

            <Pressable
              onPress={handleAdd}
              disabled={saving}
              style={({ pressed }) => [styles.addBtn, (pressed || saving) && { opacity: 0.6 }]}
            >
              {saving
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={styles.addBtnText}>Add Alert</Text>}
            </Pressable>
          </View>

          {/* Existing alerts */}
          {loading ? (
            <ActivityIndicator color={C.tint} style={{ marginTop: 24 }} />
          ) : alerts.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="notifications-off-outline" size={32} color={C.textMuted} />
              <Text style={styles.emptyText}>No budget alerts yet</Text>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Active Alerts</Text>
              {alerts.map((alert, i) => {
                const spent = spendingMap[alert.category] ?? 0;
                const pct = Math.min((spent / alert.threshold) * 100, 100);
                const over = spent >= alert.threshold;
                return (
                  <View key={alert.id}>
                    {i > 0 && <View style={styles.divider} />}
                    <View style={styles.alertRow}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.alertTop}>
                          <Text style={styles.alertCategory}>{alert.category}</Text>
                          <Text style={[styles.alertThreshold, over && { color: C.negative }]}>
                            ${spent.toFixed(0)} / ${alert.threshold.toFixed(0)}
                          </Text>
                        </View>
                        <View style={styles.progressTrack}>
                          <View
                            style={[
                              styles.progressFill,
                              { width: `${pct}%`, backgroundColor: over ? C.negative : C.tint },
                            ]}
                          />
                        </View>
                      </View>
                      <Pressable
                        onPress={() => handleDelete(alert.id, alert.category)}
                        hitSlop={10}
                        style={styles.deleteBtn}
                      >
                        <Ionicons name="trash-outline" size={16} color={C.negative} />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: { fontFamily: "DM_Sans_700Bold", fontSize: 17, color: C.text },
  cancelBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  cancelText: { fontFamily: "DM_Sans_500Medium", fontSize: 16, color: C.tint },

  scrollContent: { padding: 20, gap: 16 },

  desc: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 13,
    color: C.textMuted,
    lineHeight: 18,
  },

  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    gap: 8,
  },
  cardTitle: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 14,
    color: C.textSecondary,
    marginBottom: 4,
  },

  fieldLabel: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 13,
    color: C.textSecondary,
  },

  picker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 4,
  },
  pickerText: { fontFamily: "DM_Sans_400Regular", fontSize: 15, color: C.text },

  dropdownList: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    overflow: "hidden",
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  dropdownItemSelected: { backgroundColor: `${C.tint}12` },
  dropdownText: { fontFamily: "DM_Sans_400Regular", fontSize: 14, color: C.text },

  input: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 15,
    color: C.text,
  },

  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    marginTop: 4,
    overflow: "hidden",
  },
  dollarSign: {
    paddingHorizontal: 14,
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 16,
    color: C.textSecondary,
  },
  amountInput: {
    flex: 1,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 15,
    color: C.text,
    paddingVertical: 12,
    paddingRight: 14,
  },

  errorText: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 12,
    color: C.negative,
  },

  addBtn: {
    backgroundColor: C.tint,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 4,
  },
  addBtnText: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 15,
    color: "#000",
  },

  emptyWrap: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 32,
  },
  emptyText: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 14,
    color: C.textMuted,
  },

  divider: { height: 1, backgroundColor: C.border, marginVertical: 4 },

  alertRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  alertTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  alertCategory: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 14,
    color: C.text,
  },
  alertThreshold: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 13,
    color: C.textSecondary,
  },
  progressTrack: {
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  deleteBtn: {
    padding: 4,
  },
});
