import React, { useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Colors from "@/constants/colors";
import { useFinance } from "@/context/FinanceContext";

const C = Colors.dark;

function formatCAD(amount: number, decimals = 0): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-CA", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

function BudgetBar({ category, limit, spent }: { category: string; limit: number; spent: number }) {
  const pct = Math.min(spent / limit, 1);
  const isOver = spent > limit;
  const remaining = Math.max(limit - spent, 0);

  const barColor = isOver ? C.negative : pct > 0.8 ? C.gold : C.tint;

  const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
    Groceries: "basket-outline",
    Dining: "restaurant-outline",
    Transport: "car-outline",
    Entertainment: "film-outline",
    Shopping: "bag-outline",
    Utilities: "flash-outline",
    Health: "medical-outline",
  };
  const icon = ICONS[category] ?? "ellipse-outline";

  return (
    <View style={styles.budgetRow}>
      <View style={[styles.budgetIcon, { backgroundColor: `${barColor}20` }]}>
        <Ionicons name={icon} size={16} color={barColor} />
      </View>
      <View style={styles.budgetInfo}>
        <View style={styles.budgetHeader}>
          <Text style={styles.budgetCategory}>{category}</Text>
          <Text style={[styles.budgetSpent, isOver && { color: C.negative }]}>
            {formatCAD(spent)} / {formatCAD(limit)}
          </Text>
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: barColor }]} />
        </View>
        <Text style={styles.budgetRemaining}>
          {isOver ? (
            <Text style={{ color: C.negative }}>{formatCAD(spent - limit)} over budget</Text>
          ) : (
            <Text style={{ color: C.textMuted }}>{formatCAD(remaining)} remaining</Text>
          )}
        </Text>
      </View>
    </View>
  );
}

function SpendingPieChart({ data }: { data: { category: string; amount: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.amount, 0);
  if (total === 0) return null;

  let cumulative = 0;
  const SIZE = 160;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R = 60;
  const INNER = 38;

  function polarToXY(angle: number, r: number) {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
  }

  function arc(startAngle: number, endAngle: number, r: number) {
    const start = polarToXY(startAngle, r);
    const end = polarToXY(endAngle, r);
    const large = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
  }

  const SVGPath = Platform.OS !== "web"
    ? require("react-native-svg")
    : null;

  if (Platform.OS === "web") {
    return (
      <View style={styles.pieContainer}>
        {data.map((d, i) => {
          const startDeg = (cumulative / total) * 360;
          const endDeg = ((cumulative + d.amount) / total) * 360;
          cumulative += d.amount;
          const pct = Math.round((d.amount / total) * 100);
          if (pct < 2) return null;
          return null;
        })}
        <View style={styles.webPieGrid}>
          {data.map((d) => {
            const pct = Math.round((d.amount / total) * 100);
            return (
              <View key={d.category} style={styles.webPieItem}>
                <View style={[styles.webPieDot, { backgroundColor: d.color }]} />
                <Text style={styles.webPieLabel}>{d.category}</Text>
                <Text style={styles.webPiePct}>{pct}%</Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  const { Svg, Path, Circle, G } = require("react-native-svg");

  const segments: React.ReactNode[] = [];
  let cum = 0;
  data.forEach((d, i) => {
    const startAngle = (cum / total) * 360;
    const endAngle = ((cum + d.amount) / total) * 360;
    cum += d.amount;
    const gap = 2;
    const s = polarToXY(startAngle + gap, R);
    const e = polarToXY(endAngle - gap, R);
    const si = polarToXY(startAngle + gap, INNER);
    const ei = polarToXY(endAngle - gap, INNER);
    const large = endAngle - startAngle - gap * 2 > 180 ? 1 : 0;
    const d_path = `M ${si.x} ${si.y} L ${s.x} ${s.y} A ${R} ${R} 0 ${large} 1 ${e.x} ${e.y} L ${ei.x} ${ei.y} A ${INNER} ${INNER} 0 ${large} 0 ${si.x} ${si.y} Z`;
    segments.push(
      <Path key={d.category} d={d_path} fill={d.color} opacity={0.9} />
    );
  });

  return (
    <View style={styles.pieContainer}>
      <Svg width={SIZE} height={SIZE}>
        {segments}
        <Circle cx={CX} cy={CY} r={INNER - 2} fill={C.card} />
      </Svg>
      <View style={styles.pieLegend}>
        {data.map((d) => {
          const pct = Math.round((d.amount / total) * 100);
          if (pct < 2) return null;
          return (
            <View key={d.category} style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: d.color }]} />
              <Text style={styles.legendLabel}>{d.category}</Text>
              <Text style={styles.legendPct}>{pct}%</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function AccountAllocation({ accounts }: { accounts: { name: string; type: string; balance: number; color: string }[] }) {
  const positiveAccounts = accounts.filter((a) => a.balance > 0);
  const total = positiveAccounts.reduce((s, a) => s + a.balance, 0);

  return (
    <View style={styles.card}>
      {positiveAccounts.map((a) => {
        const pct = total > 0 ? (a.balance / total) : 0;
        return (
          <View key={a.name} style={styles.allocRow}>
            <View style={styles.allocInfo}>
              <View style={[styles.allocDot, { backgroundColor: a.color }]} />
              <Text style={styles.allocName}>{a.name}</Text>
            </View>
            <View style={styles.allocRight}>
              <Text style={styles.allocPct}>{Math.round(pct * 100)}%</Text>
              <Text style={styles.allocAmount}>{formatCAD(a.balance)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  Groceries: "#00D4A0",
  Dining: "#F5C842",
  Transport: "#56CFE1",
  Entertainment: "#C77DFF",
  Shopping: "#FF6B6B",
  Utilities: "#FFB347",
  Health: "#6EDDA0",
  Other: "#8DB89A",
};

export default function InsightsScreen() {
  const insets = useSafeAreaInsets();
  const { transactions, budgets, accounts, monthlyIncome, monthlyExpenses } = useFinance();

  const topPad = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;

  const categorySpend = useMemo(() => {
    const now = new Date();
    const map: Record<string, number> = {};
    transactions.forEach((t) => {
      const d = new Date(t.date);
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && t.amount < 0) {
        const cat = t.category;
        map[cat] = (map[cat] || 0) + Math.abs(t.amount);
      }
    });
    return Object.entries(map)
      .map(([category, amount]) => ({
        category,
        amount,
        color: CATEGORY_COLORS[category] ?? "#8DB89A",
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [transactions]);

  const totalBudget = budgets.reduce((s, b) => s + b.limit, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.spent, 0);
  const budgetPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  const savings = monthlyIncome - monthlyExpenses;
  const savingsRate = monthlyIncome > 0 ? Math.round((savings / monthlyIncome) * 100) : 0;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Insights</Text>
        <View style={styles.monthBadge}>
          <Text style={styles.monthText}>February 2026</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.scrollContent,
          Platform.OS === "web" && { paddingBottom: 34 },
        ]}
      >
        <View style={styles.statGrid}>
          <LinearGradient
            colors={["#0F3D28", "#091E14"]}
            style={styles.statCard}
          >
            <Ionicons name="arrow-down-circle-outline" size={22} color={C.positive} />
            <Text style={styles.statValue}>{formatCAD(monthlyIncome)}</Text>
            <Text style={styles.statLabel}>Monthly Income</Text>
          </LinearGradient>
          <LinearGradient
            colors={["#2A100A", "#150907"]}
            style={styles.statCard}
          >
            <Ionicons name="arrow-up-circle-outline" size={22} color={C.negative} />
            <Text style={[styles.statValue, { color: C.negative }]}>{formatCAD(monthlyExpenses)}</Text>
            <Text style={styles.statLabel}>Monthly Spend</Text>
          </LinearGradient>
          <LinearGradient
            colors={["#1A1500", "#0D0B00"]}
            style={styles.statCard}
          >
            <Ionicons name="trending-up-outline" size={22} color={C.gold} />
            <Text style={[styles.statValue, { color: C.gold }]}>{savingsRate}%</Text>
            <Text style={styles.statLabel}>Savings Rate</Text>
          </LinearGradient>
          <LinearGradient
            colors={["#0A0F20", "#06090F"]}
            style={styles.statCard}
          >
            <Ionicons name="wallet-outline" size={22} color="#56CFE1" />
            <Text style={[styles.statValue, { color: "#56CFE1" }]}>{formatCAD(Math.max(savings, 0))}</Text>
            <Text style={styles.statLabel}>Saved</Text>
          </LinearGradient>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Spending by Category</Text>
          <View style={styles.card}>
            <SpendingPieChart data={categorySpend} />
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Budget Tracker</Text>
            <Text style={[
              styles.budgetSummaryPct,
              { color: budgetPct > 90 ? C.negative : budgetPct > 70 ? C.gold : C.tint }
            ]}>
              {budgetPct}% used
            </Text>
          </View>
          <View style={styles.card}>
            {budgets.map((b, i) => (
              <View key={b.category}>
                <BudgetBar {...b} />
                {i < budgets.length - 1 && <View style={styles.rowDivider} />}
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Portfolio Allocation</Text>
          <AccountAllocation accounts={accounts} />
        </View>

        <View style={styles.tipsSection}>
          <Text style={styles.sectionTitle}>Canadian Tax Tips</Text>
          {[
            { icon: "leaf-outline" as const, tip: "2026 TFSA contribution limit is $7,000. Unused room carries forward." },
            { icon: "time-outline" as const, tip: "RRSP deadline is 60 days after year-end. Contribute to reduce taxable income." },
            { icon: "home-outline" as const, tip: "FHSA lets first-time buyers save $40,000 tax-free toward a home." },
          ].map(({ icon, tip }) => (
            <View key={tip} style={styles.tipCard}>
              <View style={styles.tipIcon}>
                <Ionicons name={icon} size={16} color={C.tint} />
              </View>
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerTitle: { fontFamily: "DM_Sans_700Bold", fontSize: 28, color: C.text, letterSpacing: -0.5 },
  monthBadge: {
    backgroundColor: C.elevated,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1, borderColor: C.border,
  },
  monthText: { fontFamily: "DM_Sans_500Medium", fontSize: 12, color: C.textSecondary },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 120, gap: 24 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: {
    flex: 1,
    minWidth: "45%",
    borderRadius: 16,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  statValue: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 20,
    color: C.text,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 12,
    color: C.textMuted,
  },
  section: { gap: 10 },
  sectionTitle: { fontFamily: "DM_Sans_600SemiBold", fontSize: 17, color: C.text },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  budgetSummaryPct: { fontFamily: "DM_Sans_600SemiBold", fontSize: 14 },
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  pieContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    gap: 16,
    flexWrap: "wrap",
  },
  pieLegend: { flex: 1, gap: 8, minWidth: 100 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { flex: 1, fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textSecondary },
  legendPct: { fontFamily: "DM_Sans_600SemiBold", fontSize: 13, color: C.text },
  webPieGrid: { gap: 8 },
  webPieItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  webPieDot: { width: 10, height: 10, borderRadius: 5 },
  webPieLabel: { flex: 1, fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textSecondary },
  webPiePct: { fontFamily: "DM_Sans_600SemiBold", fontSize: 13, color: C.text },
  budgetRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  budgetIcon: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  budgetInfo: { flex: 1, gap: 4 },
  budgetHeader: { flexDirection: "row", justifyContent: "space-between" },
  budgetCategory: { fontFamily: "DM_Sans_500Medium", fontSize: 14, color: C.text },
  budgetSpent: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.textSecondary },
  barTrack: {
    height: 6, backgroundColor: C.elevated,
    borderRadius: 3, overflow: "hidden",
  },
  barFill: { height: "100%", borderRadius: 3 },
  budgetRemaining: { fontFamily: "DM_Sans_400Regular", fontSize: 12 },
  rowDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 16 },
  allocRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  allocInfo: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  allocDot: { width: 10, height: 10, borderRadius: 5 },
  allocName: { fontFamily: "DM_Sans_500Medium", fontSize: 14, color: C.text },
  allocRight: { alignItems: "flex-end", gap: 2 },
  allocPct: { fontFamily: "DM_Sans_700Bold", fontSize: 14, color: C.tint },
  allocAmount: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted },
  tipsSection: { gap: 10 },
  tipCard: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: `${C.tint}10`,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: `${C.tint}20`,
    alignItems: "flex-start",
  },
  tipIcon: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: `${C.tint}20`,
    alignItems: "center", justifyContent: "center",
  },
  tipText: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 13,
    color: C.textSecondary,
    flex: 1,
    lineHeight: 20,
  },
});
