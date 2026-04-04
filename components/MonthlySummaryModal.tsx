/**
 * MonthlySummaryModal
 *
 * Shown when the user taps the monthly summary notification.
 * Computes the previous month's financial summary from local transaction data.
 * After dismissal the modal is NOT accessible again in-app — only via email.
 */
import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useFinance } from "@/context/FinanceContext";
import Colors from "@/constants/colors";

const C = Colors.dark;

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function MonthlySummaryModal({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { transactions, accounts, monthlyIncome } = useFinance();

  const summary = useMemo(() => {
    const now = new Date();
    // Previous month
    const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const monthName = MONTH_NAMES[prevMonth];

    const prevTxs = transactions.filter((t) => {
      const d = new Date(t.date);
      return d.getMonth() === prevMonth && d.getFullYear() === prevYear;
    });

    const income = prevTxs
      .filter((t) => t.amount > 0)
      .reduce((s, t) => s + t.amount, 0);

    const expenses = Math.abs(
      prevTxs.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0)
    );

    const savings = income - expenses;

    // Top spending categories
    const categoryMap: Record<string, number> = {};
    prevTxs
      .filter((t) => t.amount < 0)
      .forEach((t) => {
        categoryMap[t.category] = (categoryMap[t.category] ?? 0) + Math.abs(t.amount);
      });
    const topCategories = Object.entries(categoryMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([cat, amt]) => ({ cat, amt }));

    const netWorth = accounts.reduce((s, a) => s + a.balance, 0);

    return { monthName, prevYear, income, expenses, savings, topCategories, netWorth };
  }, [transactions, accounts]);

  const savingsRate =
    summary.income > 0
      ? Math.round((summary.savings / summary.income) * 100)
      : 0;

  const fmt = (n: number) =>
    n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ width: 60 }} />
          <Text style={styles.title}>Monthly Summary</Text>
          <Pressable onPress={handleClose} style={styles.doneBtn}>
            <Text style={styles.doneBtnText}>Done</Text>
          </Pressable>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Period label */}
          <Text style={styles.period}>
            {summary.monthName} {summary.prevYear}
          </Text>

          {/* Key metrics */}
          <View style={styles.metricsGrid}>
            <MetricCard
              icon="arrow-up-circle-outline"
              iconColor="#4ADE80"
              label="Income"
              value={`$${fmt(summary.income)}`}
            />
            <MetricCard
              icon="arrow-down-circle-outline"
              iconColor={C.negative}
              label="Expenses"
              value={`$${fmt(summary.expenses)}`}
            />
            <MetricCard
              icon="wallet-outline"
              iconColor={summary.savings >= 0 ? C.tint : C.negative}
              label="Saved"
              value={`${summary.savings < 0 ? "-" : ""}$${fmt(Math.abs(summary.savings))}`}
              sub={`${savingsRate}% savings rate`}
            />
            <MetricCard
              icon="trending-up-outline"
              iconColor={C.gold}
              label="Net Worth"
              value={`$${fmt(summary.netWorth)}`}
            />
          </View>

          {/* Top spending */}
          {summary.topCategories.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Top Spending Categories</Text>
              <View style={styles.card}>
                {summary.topCategories.map(({ cat, amt }, i) => {
                  const pct =
                    summary.expenses > 0
                      ? Math.round((amt / summary.expenses) * 100)
                      : 0;
                  return (
                    <View key={cat}>
                      {i > 0 && <View style={styles.divider} />}
                      <View style={styles.catRow}>
                        <Text style={styles.catName}>{cat}</Text>
                        <View style={styles.catRight}>
                          <Text style={styles.catPct}>{pct}%</Text>
                          <Text style={styles.catAmt}>${fmt(amt)}</Text>
                        </View>
                      </View>
                      <View style={styles.progressTrack}>
                        <View
                          style={[styles.progressFill, { width: `${pct}%` }]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Email note */}
          <View style={styles.emailNote}>
            <Ionicons name="mail-outline" size={16} color={C.textMuted} />
            <Text style={styles.emailNoteText}>
              A full copy of this summary has been sent to your email. After closing, it won&apos;t be accessible here again.
            </Text>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

function MetricCard({
  icon,
  iconColor,
  label,
  value,
  sub,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <View style={metricStyles.card}>
      <View style={[metricStyles.iconWrap, { backgroundColor: `${iconColor}18` }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <Text style={metricStyles.label}>{label}</Text>
      <Text style={metricStyles.value}>{value}</Text>
      {sub ? <Text style={metricStyles.sub}>{sub}</Text> : null}
    </View>
  );
}

const metricStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    gap: 4,
    minWidth: "46%",
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  label: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 12,
    color: C.textMuted,
  },
  value: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 18,
    color: C.text,
    letterSpacing: -0.3,
  },
  sub: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 11,
    color: C.textMuted,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 17,
    color: C.text,
  },
  doneBtn: { paddingHorizontal: 4, paddingVertical: 4, alignItems: "flex-end", width: 60 },
  doneBtnText: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 16,
    color: C.tint,
  },

  scrollContent: { padding: 20, gap: 20 },

  period: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 22,
    color: C.text,
    letterSpacing: -0.3,
  },

  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },

  section: { gap: 10 },
  sectionTitle: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 14,
    color: C.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    gap: 4,
  },

  divider: { height: 1, backgroundColor: C.border, marginVertical: 6 },

  catRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  catName: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 14,
    color: C.text,
    flex: 1,
  },
  catRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  catPct: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 12,
    color: C.textMuted,
  },
  catAmt: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 14,
    color: C.text,
    minWidth: 70,
    textAlign: "right",
  },
  progressTrack: {
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 4,
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: C.tint,
  },

  emailNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: `${C.tint}10`,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${C.tint}30`,
    padding: 14,
  },
  emailNoteText: {
    flex: 1,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 13,
    color: C.textMuted,
    lineHeight: 18,
  },
});
