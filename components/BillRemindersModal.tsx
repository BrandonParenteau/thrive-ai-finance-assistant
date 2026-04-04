/**
 * BillRemindersModal
 *
 * Lets users create individual bill reminders with a name, optional amount,
 * and day of the month. Each reminder schedules its own CALENDAR notification
 * and is stored in Firestore: users/{uid}/billReminders/{reminderId}
 * Shape: { id, name, amount?, dayOfMonth }
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
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const C = Colors.dark;

export interface BillReminder {
  id: string;
  name: string;
  amount?: number;
  dayOfMonth: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function BillRemindersModal({ visible, onClose }: Props) {
  const { user } = useAuth();

  const [reminders, setReminders] = useState<BillReminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [formError, setFormError] = useState("");

  // Load existing reminders
  useEffect(() => {
    if (!visible || !user) return;
    setLoading(true);
    getDocs(collection(db, "users", user.id, "billReminders"))
      .then((snap) => {
        setReminders(
          snap.docs.map((d) => {
            const data = d.data() as Record<string, any>;
            return {
              id: d.id,
              name: data.name ?? "Bill",
              amount: data.amount != null ? Number(data.amount) : undefined,
              dayOfMonth: Number(data.dayOfMonth) || 1,
            };
          })
        );
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [visible, user]);

  const scheduleReminderNotification = useCallback(
    async (reminder: BillReminder) => {
      if (Platform.OS === "web") return;
      const notifId = `thrive_bill_${reminder.id}`;
      await Notifications.cancelScheduledNotificationAsync(notifId).catch(() => {});

      const amountStr = reminder.amount
        ? ` ($${reminder.amount.toFixed(2)})`
        : "";

      // Clamp day to 1-28 to work in all months
      const safeDay = Math.min(Math.max(Math.round(reminder.dayOfMonth), 1), 28);

      await Notifications.scheduleNotificationAsync({
        identifier: notifId,
        content: {
          title: `Bill Due: ${reminder.name}`,
          body: `Your ${reminder.name}${amountStr} bill is due today. Open Thrive to review your budget.`,
          data: { screen: "/(tabs)/insights", type: "bill_reminder", billId: reminder.id },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
          day: safeDay,
          hour: 9,
          minute: 0,
          repeats: true,
        },
      }).catch(() => {});
    },
    []
  );

  const cancelReminderNotification = useCallback(async (reminderId: string) => {
    if (Platform.OS === "web") return;
    await Notifications.cancelScheduledNotificationAsync(
      `thrive_bill_${reminderId}`
    ).catch(() => {});
  }, []);

  const handleAdd = async () => {
    setFormError("");
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError("Please enter a bill name.");
      return;
    }
    const day = parseInt(dayOfMonth);
    if (isNaN(day) || day < 1 || day > 28) {
      setFormError("Day must be between 1 and 28.");
      return;
    }
    const parsedAmount = amount ? parseFloat(amount) : undefined;
    if (parsedAmount !== undefined && (isNaN(parsedAmount) || parsedAmount < 0)) {
      setFormError("Please enter a valid amount.");
      return;
    }
    if (!user) return;
    setSaving(true);
    try {
      const data: Record<string, any> = { name: trimmedName, dayOfMonth: day };
      if (parsedAmount !== undefined) data.amount = parsedAmount;
      const docRef = await addDoc(
        collection(db, "users", user.id, "billReminders"),
        data
      );
      const newReminder: BillReminder = { id: docRef.id, name: trimmedName, dayOfMonth: day, amount: parsedAmount };
      setReminders((prev) => [...prev, newReminder]);
      await scheduleReminderNotification(newReminder);
      setName("");
      setAmount("");
      setDayOfMonth("1");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setFormError("Failed to save reminder. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (reminder: BillReminder) => {
    Alert.alert(
      "Remove Reminder",
      `Remove the "${reminder.name}" bill reminder?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            if (!user) return;
            try {
              await deleteDoc(
                doc(db, "users", user.id, "billReminders", reminder.id)
              );
              await cancelReminderNotification(reminder.id);
              setReminders((prev) => prev.filter((r) => r.id !== reminder.id));
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            } catch {
              Alert.alert("Error", "Failed to remove reminder.");
            }
          },
        },
      ]
    );
  };

  const ordinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Done</Text>
          </Pressable>
          <Text style={styles.title}>Bill Reminders</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={Keyboard.dismiss}
        >
          <Text style={styles.desc}>
            Add your recurring bills and we&apos;ll remind you on the day they&apos;re due each month.
          </Text>

          {/* Add new reminder */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Add Reminder</Text>

            <Text style={styles.fieldLabel}>Bill Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Netflix, Rent, Hydro"
              placeholderTextColor={C.textMuted}
            />

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Amount (optional)</Text>
            <View style={styles.amountRow}>
              <Text style={styles.dollarSign}>$</Text>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={C.textMuted}
              />
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Day of Month (1–28)</Text>
            <TextInput
              style={styles.input}
              value={dayOfMonth}
              onChangeText={setDayOfMonth}
              keyboardType="number-pad"
              placeholder="1"
              placeholderTextColor={C.textMuted}
              maxLength={2}
            />
            <Text style={styles.hint}>
              Notification fires at 9:00 AM on the {ordinal(parseInt(dayOfMonth) || 1)} of each month.
            </Text>

            {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

            <Pressable
              onPress={handleAdd}
              disabled={saving}
              style={({ pressed }) => [styles.addBtn, (pressed || saving) && { opacity: 0.6 }]}
            >
              {saving
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={styles.addBtnText}>Add Reminder</Text>}
            </Pressable>
          </View>

          {/* Existing reminders */}
          {loading ? (
            <ActivityIndicator color={C.tint} style={{ marginTop: 24 }} />
          ) : reminders.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="calendar-outline" size={32} color={C.textMuted} />
              <Text style={styles.emptyText}>No bill reminders yet</Text>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Your Reminders</Text>
              {reminders.map((r, i) => (
                <View key={r.id}>
                  {i > 0 && <View style={styles.divider} />}
                  <View style={styles.reminderRow}>
                    <View style={styles.reminderIcon}>
                      <Ionicons name="receipt-outline" size={16} color={C.tint} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reminderName}>{r.name}</Text>
                      <Text style={styles.reminderMeta}>
                        {r.amount != null ? `$${r.amount.toFixed(2)} · ` : ""}
                        Due {ordinal(r.dayOfMonth)} of each month
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => handleDelete(r)}
                      hitSlop={10}
                      style={styles.deleteBtn}
                    >
                      <Ionicons name="trash-outline" size={16} color={C.negative} />
                    </Pressable>
                  </View>
                </View>
              ))}
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
    marginTop: 4,
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

  hint: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 11,
    color: C.textMuted,
    marginTop: 2,
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

  divider: { height: 1, backgroundColor: C.border, marginVertical: 2 },

  reminderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  reminderIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: `${C.tint}18`,
    alignItems: "center",
    justifyContent: "center",
  },
  reminderName: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 14,
    color: C.text,
  },
  reminderMeta: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 12,
    color: C.textMuted,
    marginTop: 2,
  },
  deleteBtn: { padding: 4 },
});
