import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
  Pressable,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Colors from "@/constants/colors";
import { useFinance } from "@/context/FinanceContext";
import { useAuth } from "@/context/AuthContext";

const C = Colors.dark;

function formatCAD(amount: number, decimals = 0): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-CA", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Groceries: "basket-outline", Dining: "restaurant-outline", Transport: "car-outline",
  Entertainment: "film-outline", Shopping: "bag-outline", Utilities: "flash-outline",
  Health: "medical-outline", Income: "arrow-down-circle-outline",
  Housing: "home-outline", Travel: "airplane-outline", Other: "ellipse-outline",
  Subscriptions: "refresh-circle-outline", "Personal Care": "sparkles-outline",
  Education: "school-outline", Fitness: "barbell-outline", Coffee: "cafe-outline",
  Insurance: "shield-outline", Investments: "trending-up-outline", Gifts: "gift-outline",
  Pets: "paw-outline", Clothing: "shirt-outline", Electronics: "phone-portrait-outline",
  Alcohol: "wine-outline", Childcare: "people-outline", Taxes: "document-text-outline",
};

const CATEGORY_COLORS: Record<string, string> = {
  Groceries: "#00D4A0", Dining: "#F5C842", Transport: "#56CFE1",
  Entertainment: "#C77DFF", Shopping: "#FF6B6B", Utilities: "#FFB347",
  Health: "#6EDDA0", Housing: "#FF8A65", Travel: "#80DEEA",
  "Personal Care": "#F48FB1", Subscriptions: "#80CBC4", Income: "#32C86E",
  Coffee: "#D4A574", Education: "#4FC3F7", Fitness: "#AED581",
  Insurance: "#90CAF9", Investments: "#FFD54F", Gifts: "#F06292",
  Pets: "#FFCC80", Clothing: "#CE93D8", Electronics: "#80DEEA",
  Alcohol: "#EF9A9A", Childcare: "#80CBC4", Taxes: "#B0BEC5", Other: "#8DB89A",
};

function BudgetBar({
  category, limit, spent,
  onEditPress,
}: {
  category: string; limit: number; spent: number;
  onEditPress: () => void;
}) {
  const pct = Math.min(spent / limit, 1);
  const isOver = spent > limit;
  const remaining = Math.max(limit - spent, 0);
  const barColor = isOver ? C.negative : pct > 0.8 ? C.gold : C.tint;
  const icon = CATEGORY_ICONS[category] ?? "ellipse-outline";

  return (
    <View style={styles.budgetRow}>
      <View style={[styles.budgetIcon, { backgroundColor: `${barColor}20` }]}>
        <Ionicons name={icon} size={16} color={barColor} />
      </View>
      <View style={styles.budgetInfo}>
        <View style={styles.budgetHeader}>
          <Text style={styles.budgetCategory}>{category}</Text>
          <View style={styles.budgetHeaderRight}>
            <Text style={[styles.budgetSpent, isOver && { color: C.negative }]}>
              {formatCAD(spent)} / {formatCAD(limit)}
            </Text>
            <Pressable onPress={onEditPress} style={styles.editBudgetBtn} hitSlop={8}>
              <Ionicons name="pencil-outline" size={13} color={C.textMuted} />
            </Pressable>
          </View>
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
  if (total === 0) return (
    <View style={styles.emptyPie}>
      <Ionicons name="pie-chart-outline" size={40} color={C.textMuted} />
      <Text style={styles.emptyPieText}>No spending data this month</Text>
    </View>
  );

  if (Platform.OS === "web") {
    return (
      <View style={styles.pieContainer}>
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

  const SIZE = 160, CX = 80, CY = 80, R = 60, INNER = 38;
  function polarToXY(angle: number, r: number) {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
  }

  const { Svg, Path, Circle } = require("react-native-svg");
  const segments: React.ReactNode[] = [];
  let cum = 0;
  data.forEach((d) => {
    const startAngle = (cum / total) * 360;
    const endAngle = ((cum + d.amount) / total) * 360;
    cum += d.amount;
    const gap = 2;
    const s = polarToXY(startAngle + gap, R);
    const e = polarToXY(endAngle - gap, R);
    const si = polarToXY(startAngle + gap, INNER);
    const ei = polarToXY(endAngle - gap, INNER);
    const large = endAngle - startAngle - gap * 2 > 180 ? 1 : 0;
    const path = `M ${si.x} ${si.y} L ${s.x} ${s.y} A ${R} ${R} 0 ${large} 1 ${e.x} ${e.y} L ${ei.x} ${ei.y} A ${INNER} ${INNER} 0 ${large} 0 ${si.x} ${si.y} Z`;
    segments.push(<Path key={d.category} d={path} fill={d.color} opacity={0.9} />);
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

function EditBudgetModal({
  visible, category, currentLimit, onSave, onClose,
}: {
  visible: boolean; category: string; currentLimit: number;
  onSave: (newLimit: number) => void; onClose: () => void;
}) {
  const [value, setValue] = useState(currentLimit.toString());
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) { Alert.alert("Invalid", "Enter a valid amount"); return; }
    setLoading(true);
    onSave(num);
    setLoading(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>Edit Budget</Text>
          <Text style={styles.modalSubtitle}>{category}</Text>
          <View style={styles.modalInputRow}>
            <Text style={styles.modalCurrency}>$</Text>
            <TextInput
              style={styles.modalInput}
              value={value}
              onChangeText={setValue}
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
            />
          </View>
          <View style={styles.modalActions}>
            <Pressable style={styles.modalCancelBtn} onPress={onClose}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.modalSaveBtn} onPress={handleSave} disabled={loading}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.modalSaveText}>Save</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function EditIncomeModal({
  visible, currentIncome, onSave, onClose,
}: {
  visible: boolean; currentIncome: number;
  onSave: (income: number) => void; onClose: () => void;
}) {
  const [value, setValue] = useState(currentIncome > 0 ? currentIncome.toString() : "");
  const [loading, setLoading] = useState(false);

  const handleSave = () => {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) { Alert.alert("Invalid", "Enter a valid income"); return; }
    setLoading(true);
    onSave(num);
    setLoading(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>Monthly Income</Text>
          <Text style={styles.modalSubtitle}>Net income (after tax)</Text>
          <View style={styles.modalInputRow}>
            <Text style={styles.modalCurrency}>$</Text>
            <TextInput
              style={styles.modalInput}
              value={value}
              onChangeText={setValue}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={C.textMuted}
              autoFocus
              selectTextOnFocus
            />
          </View>
          <View style={styles.modalActions}>
            <Pressable style={styles.modalCancelBtn} onPress={onClose}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.modalSaveBtn} onPress={handleSave} disabled={loading}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.modalSaveText}>Save</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function InsightsScreen() {
  const insets = useSafeAreaInsets();
  const { transactions, budgets, accounts, monthlyIncome, monthlyExpenses, setBudgets } = useFinance();
  const { updateProfile } = useAuth();

  const [editingBudget, setEditingBudget] = useState<{ category: string; limit: number } | null>(null);
  const [editingIncome, setEditingIncome] = useState(false);

  const topPad = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;

  const categorySpend = useMemo(() => {
    const now = new Date();
    const map: Record<string, number> = {};
    transactions.forEach((t) => {
      const d = new Date(t.date);
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && t.amount < 0) {
        map[t.category] = (map[t.category] || 0) + Math.abs(t.amount);
      }
    });
    return Object.entries(map)
      .map(([category, amount]) => ({ category, amount, color: CATEGORY_COLORS[category] ?? "#8DB89A" }))
      .sort((a, b) => b.amount - a.amount);
  }, [transactions]);

  const totalBudget = budgets.reduce((s, b) => s + b.limit, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.spent, 0);
  const budgetPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
  const savings = monthlyIncome - monthlyExpenses;
  const savingsRate = monthlyIncome > 0 ? Math.round((savings / monthlyIncome) * 100) : 0;

  const handleBudgetSave = async (category: string, newLimit: number) => {
    const updated = budgets.map((b) => b.category === category ? { ...b, limit: newLimit } : b);
    await setBudgets(updated);
  };

  const handleIncomeSave = async (income: number) => {
    await updateProfile({ monthly_income: income });
  };

  const now = new Date();
  const monthName = now.toLocaleDateString("en-CA", { month: "long", year: "numeric" });

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Insights</Text>
        <View style={styles.monthBadge}>
          <Text style={styles.monthText}>{monthName}</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, Platform.OS === "web" && { paddingBottom: 34 }]}
      >
        <View style={styles.statGrid}>
          <Pressable onPress={() => setEditingIncome(true)} style={{ flex: 1, minWidth: "45%" }}>
            <LinearGradient colors={["#0F3D28", "#091E14"]} style={styles.statCard}>
              <View style={styles.statCardHeader}>
                <Ionicons name="arrow-down-circle-outline" size={22} color={C.positive} />
                <Ionicons name="pencil-outline" size={12} color={C.textMuted} />
              </View>
              <Text style={styles.statValue}>{formatCAD(monthlyIncome)}</Text>
              <Text style={styles.statLabel}>Monthly Income</Text>
            </LinearGradient>
          </Pressable>
          <LinearGradient colors={["#2A100A", "#150907"]} style={[styles.statCard, { flex: 1, minWidth: "45%" }]}>
            <Ionicons name="arrow-up-circle-outline" size={22} color={C.negative} />
            <Text style={[styles.statValue, { color: C.negative }]}>{formatCAD(monthlyExpenses)}</Text>
            <Text style={styles.statLabel}>Monthly Spend</Text>
          </LinearGradient>
          <LinearGradient colors={["#1A1500", "#0D0B00"]} style={[styles.statCard, { flex: 1, minWidth: "45%" }]}>
            <Ionicons name="trending-up-outline" size={22} color={C.gold} />
            <Text style={[styles.statValue, { color: C.gold }]}>{savingsRate}%</Text>
            <Text style={styles.statLabel}>Savings Rate</Text>
          </LinearGradient>
          <LinearGradient colors={["#0A0F20", "#06090F"]} style={[styles.statCard, { flex: 1, minWidth: "45%" }]}>
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

        {budgets.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Budget Tracker</Text>
              <Text style={[styles.budgetSummaryPct, { color: budgetPct > 90 ? C.negative : budgetPct > 70 ? C.gold : C.tint }]}>
                {budgetPct}% used
              </Text>
            </View>
            <View style={styles.card}>
              {budgets.map((b, i) => (
                <View key={b.category}>
                  <BudgetBar
                    {...b}
                    onEditPress={() => setEditingBudget({ category: b.category, limit: b.limit })}
                  />
                  {i < budgets.length - 1 && <View style={styles.rowDivider} />}
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Portfolio Allocation</Text>
          <View style={styles.card}>
            {accounts.filter((a) => a.balance > 0).map((a, i, arr) => {
              const total = arr.reduce((s, x) => s + x.balance, 0);
              const pct = total > 0 ? a.balance / total : 0;
              return (
                <View key={a.id}>
                  <View style={styles.allocRow}>
                    <View style={styles.allocInfo}>
                      <View style={[styles.allocDot, { backgroundColor: a.color }]} />
                      <Text style={styles.allocName}>{a.name}</Text>
                    </View>
                    <View style={styles.allocRight}>
                      <Text style={styles.allocPct}>{Math.round(pct * 100)}%</Text>
                      <Text style={styles.allocAmount}>{formatCAD(a.balance)}</Text>
                    </View>
                  </View>
                  {i < arr.length - 1 && <View style={styles.rowDivider} />}
                </View>
              );
            })}
            {accounts.filter((a) => a.balance > 0).length === 0 && (
              <View style={styles.emptyAlloc}>
                <Text style={styles.emptyAllocText}>No investment accounts yet</Text>
              </View>
            )}
          </View>
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

      {editingBudget && (
        <EditBudgetModal
          visible
          category={editingBudget.category}
          currentLimit={editingBudget.limit}
          onSave={(newLimit) => handleBudgetSave(editingBudget.category, newLimit)}
          onClose={() => setEditingBudget(null)}
        />
      )}

      <EditIncomeModal
        visible={editingIncome}
        currentIncome={monthlyIncome}
        onSave={handleIncomeSave}
        onClose={() => setEditingIncome(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  headerTitle: { fontFamily: "DM_Sans_700Bold", fontSize: 28, color: C.text, letterSpacing: -0.5 },
  monthBadge: { backgroundColor: C.elevated, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  monthText: { fontFamily: "DM_Sans_500Medium", fontSize: 12, color: C.textSecondary },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 120, gap: 24 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: { borderRadius: 16, padding: 16, gap: 6, borderWidth: 1, borderColor: C.border },
  statCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statValue: { fontFamily: "DM_Sans_700Bold", fontSize: 20, color: C.text, letterSpacing: -0.5 },
  statLabel: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted },
  section: { gap: 10 },
  sectionTitle: { fontFamily: "DM_Sans_600SemiBold", fontSize: 17, color: C.text },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  budgetSummaryPct: { fontFamily: "DM_Sans_600SemiBold", fontSize: 14 },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  emptyPie: { padding: 32, alignItems: "center", gap: 10 },
  emptyPieText: { fontFamily: "DM_Sans_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center" },
  pieContainer: { flexDirection: "row", alignItems: "center", padding: 20, gap: 16, flexWrap: "wrap" },
  pieLegend: { flex: 1, gap: 8, minWidth: 100 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { flex: 1, fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textSecondary },
  legendPct: { fontFamily: "DM_Sans_600SemiBold", fontSize: 13, color: C.text },
  webPieGrid: { padding: 16, gap: 8 },
  webPieItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  webPieDot: { width: 10, height: 10, borderRadius: 5 },
  webPieLabel: { flex: 1, fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textSecondary },
  webPiePct: { fontFamily: "DM_Sans_600SemiBold", fontSize: 13, color: C.text },
  budgetRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  budgetIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  budgetInfo: { flex: 1, gap: 4 },
  budgetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  budgetHeaderRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  editBudgetBtn: { padding: 2 },
  budgetCategory: { fontFamily: "DM_Sans_500Medium", fontSize: 14, color: C.text },
  budgetSpent: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.textSecondary },
  barTrack: { height: 6, backgroundColor: C.elevated, borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },
  budgetRemaining: { fontFamily: "DM_Sans_400Regular", fontSize: 12 },
  rowDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 16 },
  allocRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  allocInfo: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  allocDot: { width: 10, height: 10, borderRadius: 5 },
  allocName: { fontFamily: "DM_Sans_500Medium", fontSize: 14, color: C.text },
  allocRight: { alignItems: "flex-end", gap: 2 },
  allocPct: { fontFamily: "DM_Sans_700Bold", fontSize: 14, color: C.tint },
  allocAmount: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted },
  emptyAlloc: { padding: 24, alignItems: "center" },
  emptyAllocText: { fontFamily: "DM_Sans_400Regular", fontSize: 14, color: C.textMuted },
  tipsSection: { gap: 10 },
  tipCard: { flexDirection: "row", gap: 12, backgroundColor: `${C.tint}10`, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: `${C.tint}20`, alignItems: "flex-start" },
  tipIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: `${C.tint}20`, alignItems: "center", justifyContent: "center" },
  tipText: { fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textSecondary, flex: 1, lineHeight: 20 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalCard: { backgroundColor: C.card, borderRadius: 20, padding: 24, width: "100%", maxWidth: 360, borderWidth: 1, borderColor: C.border, gap: 16 },
  modalTitle: { fontFamily: "DM_Sans_700Bold", fontSize: 20, color: C.text },
  modalSubtitle: { fontFamily: "DM_Sans_400Regular", fontSize: 14, color: C.textSecondary, marginTop: -8 },
  modalInputRow: { flexDirection: "row", alignItems: "center", backgroundColor: C.elevated, borderRadius: 14, borderWidth: 1, borderColor: C.tint, paddingHorizontal: 16 },
  modalCurrency: { fontFamily: "DM_Sans_700Bold", fontSize: 24, color: C.textSecondary, marginRight: 4 },
  modalInput: { flex: 1, fontFamily: "DM_Sans_700Bold", fontSize: 28, color: C.text, paddingVertical: 12 },
  modalActions: { flexDirection: "row", gap: 10 },
  modalCancelBtn: { flex: 1, backgroundColor: C.elevated, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  modalCancelText: { fontFamily: "DM_Sans_500Medium", fontSize: 15, color: C.textSecondary },
  modalSaveBtn: { flex: 1, backgroundColor: C.tint, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  modalSaveText: { fontFamily: "DM_Sans_600SemiBold", fontSize: 15, color: "#000" },
});