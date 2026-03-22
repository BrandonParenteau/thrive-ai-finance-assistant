import React, { useState, useEffect, useCallback } from "react";
import { router } from "expo-router";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  Platform,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
  Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import {
  collection,
  doc,
  getDocs,
  addDoc,
  deleteDoc,
} from "firebase/firestore";
import Colors from "@/constants/colors";
import { useFinance, Account, Transaction } from "@/context/FinanceContext";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import ScenarioModal from "@/components/ScenarioModal";
import StatementUploadModal from "@/components/StatementUploadModal";
import { usePro } from "@/hooks/usePro";
import LockedFeature from "@/components/LockedFeature";

const C = Colors.dark;

function formatCAD(amount: number, decimals = 2): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-CA", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

interface NetWorthPoint { date: Date; value: number }
interface Goal { id: string; name: string; targetAmount: number; targetDate: string }

function deriveMonthlyNetWorth(
  transactions: Transaction[],
  currentNetWorth: number,
  monthsBack: number,
): NetWorthPoint[] {
  const now = new Date();
  const monthlyChanges: Record<string, number> = {};
  transactions.forEach((tx) => {
    const d = new Date(tx.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    monthlyChanges[key] = (monthlyChanges[key] || 0) + tx.amount;
  });

  const points: NetWorthPoint[] = [];
  points.push({ date: new Date(now.getFullYear(), now.getMonth(), 1), value: currentNetWorth });

  let nw = currentNetWorth;
  for (let i = 1; i <= monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    nw -= (monthlyChanges[key] ?? 0);
    points.unshift({ date: d, value: nw });
  }
  return points;
}

function projectNetWorth(
  lastPoint: NetWorthPoint,
  avgMonthlySavings: number,
  monthsForward: number,
): NetWorthPoint[] {
  const points: NetWorthPoint[] = [];
  for (let i = 1; i <= monthsForward; i++) {
    const d = new Date(lastPoint.date.getFullYear(), lastPoint.date.getMonth() + i, 1);
    points.push({ date: d, value: lastPoint.value + avgMonthlySavings * i });
  }
  return points;
}

function formatChartValue(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000) return `${sign}$${Math.round(abs / 1000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

function getXLabel(date: Date, totalMonths: number): string {
  if (totalMonths <= 24) return date.toLocaleDateString("en-CA", { month: "short" });
  if (totalMonths <= 130) return `'${String(date.getFullYear()).slice(2)}`;
  return String(date.getFullYear());
}

function shouldShowXLabel(date: Date, i: number, allLen: number, totalMonths: number): boolean {
  if (totalMonths <= 24) {
    const step = Math.ceil(allLen / 6);
    return i % step === 0 || i === allLen - 1;
  }
  const mo = date.getMonth();
  const yr = date.getFullYear();
  if (totalMonths <= 130) return mo === 0 && yr % 2 === 0;
  return mo === 0 && yr % 5 === 0;
}

const PERIOD_PRESETS = [
  { label: "1Y", years: 1 },
  { label: "3Y", years: 3 },
  { label: "5Y", years: 5 },
  { label: "10Y", years: 10 },
  { label: "25Y", years: 25 },
  { label: "Custom", years: 0 },
] as const;

function NetWorthChart({
  historicalPoints,
  projectedPoints,
  goals,
  width,
  totalProjectedMonths,
}: {
  historicalPoints: NetWorthPoint[];
  projectedPoints: NetWorthPoint[];
  goals: Goal[];
  width: number;
  totalProjectedMonths: number;
}) {
  const allPoints = [...historicalPoints, ...projectedPoints];
  if (allPoints.length < 2) return null;

  if (Platform.OS === "web") {
    const last = historicalPoints[historicalPoints.length - 1];
    const first = historicalPoints[0];
    const change = last && first ? last.value - first.value : 0;
    return (
      <View style={chartStyles.webFallback}>
        <Text style={chartStyles.webFallbackLabel}>
          {change >= 0 ? "▲" : "▼"} {formatChartValue(Math.abs(change))} over {historicalPoints.length} months
        </Text>
      </View>
    );
  }

  const PAD = { top: 12, bottom: 28, left: 52, right: 16 };
  const HEIGHT = 148;
  const chartW = width - PAD.left - PAD.right;
  const chartH = HEIGHT - PAD.top - PAD.bottom;

  // Extend minVal a bit below the lowest to give breathing room
  const values = allPoints.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = (rawMax - rawMin) * 0.12 || 100;
  const minVal = rawMin - padding;
  const maxVal = rawMax + padding;
  const range = maxVal - minVal;

  const toY = (v: number) => PAD.top + chartH - ((v - minVal) / range) * chartH;
  const histLen = historicalPoints.length;
  const totalCount = allPoints.length - 1;
  const toX = (idx: number) => PAD.left + (idx / totalCount) * chartW;

  // Build path strings
  const histD = historicalPoints
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(p.value).toFixed(1)}`)
    .join(" ");

  // Area fill under historical
  const histFillD =
    histD +
    ` L ${toX(histLen - 1).toFixed(1)} ${(PAD.top + chartH).toFixed(1)}` +
    ` L ${toX(0).toFixed(1)} ${(PAD.top + chartH).toFixed(1)} Z`;

  const projD = projectedPoints
    .map((p, i) =>
      `${i === 0 ? `M ${toX(histLen - 1).toFixed(1)} ${toY(historicalPoints[histLen - 1].value).toFixed(1)} L` : "L"} ${toX(histLen + i).toFixed(1)} ${toY(p.value).toFixed(1)}`
    )
    .join(" ");

  // Y axis ticks (3 levels)
  const yTicks = [minVal + padding * 0.5, (minVal + maxVal) / 2, maxVal - padding * 0.5];

  const totalMonths = historicalPoints.length + totalProjectedMonths;

  const { Svg, Path, Line, Text: SvgText, Circle, Defs, LinearGradient: SvgGradient, Stop } = require("react-native-svg");

  return (
    <Svg width={width} height={HEIGHT}>
      <Defs>
        <SvgGradient id="histFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={C.tint} stopOpacity="0.18" />
          <Stop offset="1" stopColor={C.tint} stopOpacity="0.01" />
        </SvgGradient>
      </Defs>

      {/* Grid lines */}
      {yTicks.map((v, i) => (
        <Line
          key={`grid-${i}`}
          x1={PAD.left}
          y1={toY(v)}
          x2={PAD.left + chartW}
          y2={toY(v)}
          stroke={C.border}
          strokeWidth={1}
        />
      ))}

      {/* Y axis labels */}
      {yTicks.map((v, i) => (
        <SvgText
          key={`ylabel-${i}`}
          x={PAD.left - 5}
          y={toY(v) + 4}
          textAnchor="end"
          fontSize={9}
          fill={C.textMuted}
        >
          {formatChartValue(v)}
        </SvgText>
      ))}

      {/* Historical fill */}
      {histFillD && <Path d={histFillD} fill="url(#histFill)" />}

      {/* Historical line */}
      {histD && (
        <Path
          d={histD}
          stroke={C.tint}
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Projected dashed line */}
      {projD && (
        <Path
          d={projD}
          stroke={C.gold}
          strokeWidth={2}
          fill="none"
          strokeDasharray="5,4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Goal lines */}
      {goals.map((g) => {
        const gy = toY(g.targetAmount);
        if (gy < PAD.top || gy > PAD.top + chartH) return null;
        return (
          <Line
            key={`goal-${g.id}`}
            x1={PAD.left}
            y1={gy}
            x2={PAD.left + chartW}
            y2={gy}
            stroke={C.gold}
            strokeWidth={1}
            strokeDasharray="3,3"
            strokeOpacity={0.7}
          />
        );
      })}

      {/* Current value dot */}
      {historicalPoints.length > 0 && (
        <Circle
          cx={toX(histLen - 1)}
          cy={toY(historicalPoints[histLen - 1].value)}
          r={4}
          fill={C.tint}
          stroke={C.background}
          strokeWidth={1.5}
        />
      )}

      {/* X axis labels */}
      {allPoints.map((p, i) => {
        if (!shouldShowXLabel(p.date, i, allPoints.length, totalMonths)) return null;
        const isProj = i >= histLen;
        return (
          <SvgText
            key={`xlabel-${i}`}
            x={toX(i)}
            y={HEIGHT - 6}
            textAnchor="middle"
            fontSize={9}
            fill={isProj ? C.gold : C.textMuted}
          >
            {getXLabel(p.date, totalMonths)}
          </SvgText>
        );
      })}

      {/* Divider line between historical and projected */}
      {histLen > 0 && histLen < allPoints.length && (
        <Line
          x1={toX(histLen - 1)}
          y1={PAD.top}
          x2={toX(histLen - 1)}
          y2={PAD.top + chartH}
          stroke={C.border}
          strokeWidth={1}
          strokeDasharray="3,3"
        />
      )}
    </Svg>
  );
}

function GoalModal({
  visible,
  onSave,
  onClose,
}: {
  visible: boolean;
  onSave: (name: string, targetAmount: number, targetDate: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    const num = parseFloat(amount);
    if (!name.trim()) { Alert.alert("Error", "Enter a goal name"); return; }
    if (isNaN(num) || num <= 0) { Alert.alert("Error", "Enter a valid target amount"); return; }
    if (!date.match(/^\d{4}-\d{2}$/)) { Alert.alert("Error", "Enter a date in YYYY-MM format"); return; }
    setLoading(true);
    try {
      await onSave(name.trim(), num, date);
      setName(""); setAmount(""); setDate("");
      onClose();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to save goal");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={goalStyles.overlay} onPress={onClose}>
        <Pressable style={goalStyles.card} onPress={() => Keyboard.dismiss()}>
          <Text style={goalStyles.title}>Set a Wealth Goal</Text>
          <Text style={goalStyles.subtitle}>Track your progress on the chart</Text>

          <View style={goalStyles.field}>
            <Text style={goalStyles.label}>Goal Name</Text>
            <TextInput
              style={goalStyles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Emergency Fund, Down Payment"
              placeholderTextColor={C.textMuted}
              autoFocus
            />
          </View>

          <View style={goalStyles.field}>
            <Text style={goalStyles.label}>Target Amount (CAD)</Text>
            <View style={goalStyles.amountRow}>
              <Text style={goalStyles.dollarSign}>$</Text>
              <TextInput
                style={[goalStyles.input, { flex: 1 }]}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={C.textMuted}
              />
            </View>
          </View>

          <View style={goalStyles.field}>
            <Text style={goalStyles.label}>Target Date (YYYY-MM)</Text>
            <TextInput
              style={goalStyles.input}
              value={date}
              onChangeText={setDate}
              placeholder="e.g. 2027-01"
              placeholderTextColor={C.textMuted}
            />
          </View>

          <View style={goalStyles.actions}>
            <Pressable style={goalStyles.cancelBtn} onPress={onClose}>
              <Text style={goalStyles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={goalStyles.saveBtn} onPress={handleSave} disabled={loading}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={goalStyles.saveText}>Save Goal</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function AccountTypeLabel({ type }: { type: Account["type"] }) {
  const labels: Record<Account["type"], string> = {
    chequing: "Chequing", savings: "Savings", tfsa: "TFSA", rrsp: "RRSP",
    fhsa: "FHSA", resp: "RESP", investment: "Investment", credit: "Credit",
  };
  return <Text style={styles.accountType}>{labels[type]}</Text>;
}

function AccountCard({ account }: { account: Account }) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[styles.accountCard, animStyle]}>
      <Pressable
        onPressIn={() => { scale.value = withSpring(0.97); }}
        onPressOut={() => { scale.value = withSpring(1); }}
        style={styles.accountCardInner}
      >
        <View style={[styles.accountDot, { backgroundColor: account.color }]} />
        <View style={styles.accountInfo}>
          <Text style={styles.accountName}>{account.name}</Text>
          <View style={styles.accountMeta}>
            <Text style={styles.accountInstitution}>{account.institution}</Text>
            <AccountTypeLabel type={account.type} />
          </View>
        </View>
        <Text style={[styles.accountBalance, account.balance < 0 && { color: C.negative }]}>
          {formatCAD(account.balance)}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Groceries: "basket-outline",
  Dining: "restaurant-outline",
  Transport: "car-outline",
  Entertainment: "film-outline",
  Shopping: "bag-outline",
  Utilities: "flash-outline",
  Health: "medical-outline",
  Income: "arrow-down-circle-outline",
  Housing: "home-outline",
  Travel: "airplane-outline",
  Subscriptions: "refresh-circle-outline",
  "Personal Care": "sparkles-outline",
  Education: "school-outline",
  Fitness: "barbell-outline",
  Coffee: "cafe-outline",
  Insurance: "shield-outline",
  Investments: "trending-up-outline",
  Gifts: "gift-outline",
  Pets: "paw-outline",
  Clothing: "shirt-outline",
  Electronics: "phone-portrait-outline",
  Alcohol: "wine-outline",
  Childcare: "people-outline",
  Taxes: "document-text-outline",
  Other: "ellipse-outline",
};

// Grouped for the picker UI
export const CATEGORY_GROUPS: { label: string; categories: string[] }[] = [
  {
    label: "Everyday",
    categories: ["Groceries", "Dining", "Coffee", "Transport", "Shopping", "Clothing"],
  },
  {
    label: "Home & Life",
    categories: ["Housing", "Utilities", "Insurance", "Childcare", "Pets"],
  },
  {
    label: "Health & Wellness",
    categories: ["Health", "Fitness", "Personal Care"],
  },
  {
    label: "Leisure",
    categories: ["Entertainment", "Travel", "Subscriptions", "Alcohol", "Gifts"],
  },
  {
    label: "Finance",
    categories: ["Income", "Investments", "Taxes", "Education", "Electronics"],
  },
  {
    label: "Other",
    categories: ["Other"],
  },
];

export const ALL_CATEGORIES = CATEGORY_GROUPS.flatMap((g) => g.categories);

function TransactionRow({
  tx, onEdit, onDelete,
}: {
  tx: Transaction; onEdit: () => void; onDelete: () => void;
}) {
  const isPositive = tx.amount > 0;
  const icon = CATEGORY_ICONS[tx.category] ?? "ellipse-outline";
  const d = new Date(tx.date);
  const dateStr = d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });

  const handleLongPress = () => {
    Alert.alert(
      tx.description,
      "What would you like to do?",
      [
        { text: "Edit", onPress: onEdit },
        { text: "Delete", style: "destructive", onPress: onDelete },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  // Flag uncategorized transactions
  const isUncategorized = tx.category === "Other" || !tx.category;

  return (
    <Pressable style={styles.txRow} onPress={onEdit} onLongPress={handleLongPress} delayLongPress={400}>
      <View style={[styles.txIcon, { backgroundColor: isPositive ? `${C.positive}22` : `${C.tint}18` }]}>
        <Ionicons name={icon} size={17} color={isPositive ? C.positive : C.tint} />
      </View>
      <View style={styles.txInfo}>
        <Text style={styles.txDescription} numberOfLines={1}>{tx.description}</Text>
        <View style={styles.txMeta}>
          {isUncategorized ? (
            <View style={styles.uncategorizedBadge}>
              <Ionicons name="alert-circle-outline" size={11} color={C.gold} />
              <Text style={styles.uncategorizedText}>Tap to categorize</Text>
            </View>
          ) : (
            <Text style={styles.txCategory}>{tx.category}</Text>
          )}
          <Text style={styles.txDate}> · {dateStr}</Text>
        </View>
      </View>
      <Text style={[styles.txAmount, { color: isPositive ? C.positive : C.text }]}>
        {isPositive ? "+" : ""}{formatCAD(tx.amount)}
      </Text>
    </Pressable>
  );
}

interface TxForm {
  description: string;
  amount: string;
  category: string;
  customCategory: string;
  date: string;
  isExpense: boolean;
}

function CategoryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (cat: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customText, setCustomText] = useState("");

  const isCustom = value && !ALL_CATEGORIES.includes(value);

  const handleSelect = (cat: string) => {
    onChange(cat);
    setShowPicker(false);
    setShowCustomInput(false);
  };

  const handleCustomSave = () => {
    const trimmed = customText.trim();
    if (!trimmed) return;
    onChange(trimmed);
    setShowPicker(false);
    setShowCustomInput(false);
    setCustomText("");
  };

  return (
    <View>
      <Pressable
        style={styles.txCategoryPicker}
        onPress={() => setShowPicker((v) => !v)}
      >
        <View style={styles.catPickerLeft}>
          <Ionicons
            name={CATEGORY_ICONS[value] ?? "ellipse-outline"}
            size={16}
            color={C.tint}
          />
          <Text style={styles.txCategoryPickerText}>{value || "Select category"}</Text>
          {isCustom && (
            <View style={styles.customBadge}>
              <Text style={styles.customBadgeText}>Custom</Text>
            </View>
          )}
        </View>
        <Ionicons name={showPicker ? "chevron-up" : "chevron-down"} size={16} color={C.textMuted} />
      </Pressable>

      {showPicker && (
        <View style={styles.catPickerDropdown}>
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {CATEGORY_GROUPS.map((group) => (
              <View key={group.label}>
                <Text style={styles.catGroupLabel}>{group.label}</Text>
                <View style={styles.catGrid}>
                  {group.categories.map((cat) => (
                    <Pressable
                      key={cat}
                      style={[styles.catChip, value === cat && styles.catChipSelected]}
                      onPress={() => handleSelect(cat)}
                    >
                      <Ionicons
                        name={CATEGORY_ICONS[cat] ?? "ellipse-outline"}
                        size={13}
                        color={value === cat ? "#000" : C.textSecondary}
                      />
                      <Text style={[styles.catChipText, value === cat && styles.catChipTextSelected]}>
                        {cat}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}

            {/* Custom category option */}
            <View style={styles.catGroupLabel}>
              <Text style={styles.catGroupLabel}>Custom</Text>
            </View>
            {showCustomInput ? (
              <View style={styles.customCatRow}>
                <TextInput
                  style={styles.customCatInput}
                  value={customText}
                  onChangeText={setCustomText}
                  placeholder="e.g. Side Business, Hobbies..."
                  placeholderTextColor={C.textMuted}
                  autoFocus
                  maxLength={30}
                  onSubmitEditing={handleCustomSave}
                />
                <Pressable style={styles.customCatSaveBtn} onPress={handleCustomSave}>
                  <Text style={styles.customCatSaveText}>Add</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={styles.addCustomCatBtn}
                onPress={() => {
                  setShowCustomInput(true);
                  setCustomText(isCustom ? value : "");
                }}
              >
                <Ionicons name="add-circle-outline" size={16} color={C.tint} />
                <Text style={styles.addCustomCatText}>
                  {isCustom ? `Edit "${value}"` : "Add custom category"}
                </Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function TransactionModal({
  visible, initial, onSave, onClose,
}: {
  visible: boolean;
  initial?: Transaction | null;
  onSave: (data: Omit<Transaction, "id" | "accountId">) => Promise<void>;
  onClose: () => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState<TxForm>({
    description: initial?.description ?? "",
    amount: initial ? Math.abs(initial.amount).toString() : "",
    category: initial?.category ?? "Other",
    customCategory: "",
    date: initial?.date ?? today,
    isExpense: initial ? initial.amount < 0 : true,
  });
  const [loading, setLoading] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  React.useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => setKeyboardHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardHeight(0),
    );
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Reset form when modal opens with new initial value
  React.useEffect(() => {
    if (visible) {
      setForm({
        description: initial?.description ?? "",
        amount: initial ? Math.abs(initial.amount).toString() : "",
        category: initial?.category ?? "Other",
        customCategory: "",
        date: initial?.date ?? today,
        isExpense: initial ? initial.amount < 0 : true,
      });
    }
  }, [visible, initial?.id]);

  const handleSave = async () => {
    if (!form.description.trim()) { Alert.alert("Error", "Enter a description"); return; }
    const amt = parseFloat(form.amount);
    if (isNaN(amt) || amt <= 0) { Alert.alert("Error", "Enter a valid amount"); return; }
    if (!form.category) { Alert.alert("Error", "Select a category"); return; }
    setLoading(true);
    try {
      await onSave({
        description: form.description.trim(),
        amount: form.isExpense ? -amt : amt,
        category: form.category,
        date: form.date,
      });
      onClose();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to save");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.txModalOverlay}>
        <View style={[styles.txModalCard, keyboardHeight > 0 && { paddingBottom: keyboardHeight + 16 }]}>
          <View style={styles.txModalHeader}>
            <Text style={styles.txModalTitle}>{initial ? "Edit Transaction" : "Add Transaction"}</Text>
            <Pressable onPress={onClose}>
              <Ionicons name="close" size={22} color={C.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.txTypeRow}>
            <Pressable
              style={[styles.txTypeBtn, form.isExpense && styles.txTypeBtnActive]}
              onPress={() => setForm((f) => ({ ...f, isExpense: true }))}
            >
              <Text style={[styles.txTypeText, form.isExpense && styles.txTypeTextActive]}>Expense</Text>
            </Pressable>
            <Pressable
              style={[styles.txTypeBtn, !form.isExpense && styles.txTypeBtnActivePos]}
              onPress={() => setForm((f) => ({ ...f, isExpense: false, category: "Income" }))}
            >
              <Text style={[styles.txTypeText, !form.isExpense && styles.txTypeTextActivePos]}>Income</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 440 }} keyboardShouldPersistTaps="handled" onScrollBeginDrag={Keyboard.dismiss}>
            <View style={styles.txFormFields}>
              <View style={styles.txField}>
                <Text style={styles.txFieldLabel}>Description</Text>
                <TextInput
                  style={styles.txInput}
                  value={form.description}
                  onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
                  placeholder="e.g. Tim Hortons, Salary"
                  placeholderTextColor={C.textMuted}
                />
              </View>

              <View style={styles.txField}>
                <Text style={styles.txFieldLabel}>Amount (CAD)</Text>
                <View style={styles.txAmountRow}>
                  <Text style={styles.txDollarSign}>$</Text>
                  <TextInput
                    style={[styles.txInput, { flex: 1 }]}
                    value={form.amount}
                    onChangeText={(v) => setForm((f) => ({ ...f, amount: v }))}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={C.textMuted}
                  />
                </View>
              </View>

              <View style={styles.txField}>
                <Text style={styles.txFieldLabel}>Date</Text>
                <TextInput
                  style={styles.txInput}
                  value={form.date}
                  onChangeText={(v) => setForm((f) => ({ ...f, date: v }))}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={C.textMuted}
                />
              </View>

              <View style={styles.txField}>
                <Text style={styles.txFieldLabel}>Category</Text>
                <CategoryPicker
                  value={form.category}
                  onChange={(cat) => setForm((f) => ({ ...f, category: cat }))}
                />
              </View>
            </View>
          </ScrollView>

          <View style={styles.txModalActions}>
            <Pressable style={styles.txCancelBtn} onPress={onClose}>
              <Text style={styles.txCancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.txSaveBtn} onPress={handleSave} disabled={loading}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.txSaveText}>Save</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function NetWorthCard() {
  const { netWorth, totalAssets, totalLiabilities, monthlyIncome, monthlyExpenses } = useFinance();
  const savingsRate = monthlyIncome > 0 ? Math.round(((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100) : 0;

  return (
    <LinearGradient colors={["#0F3D28", "#0A2818", "#080F0C"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.netWorthCard}>
      <View style={styles.netWorthHeader}>
        <Text style={styles.netWorthLabel}>Net Worth</Text>
        <View style={styles.cadBadge}><Text style={styles.cadBadgeText}>CAD</Text></View>
      </View>
      <Text style={styles.netWorthAmount}>{formatCAD(netWorth, 2)}</Text>
      <View style={styles.netWorthRow}>
        <View style={styles.netWorthStat}>
          <View style={styles.statDot} />
          <View>
            <Text style={styles.statLabel}>Assets</Text>
            <Text style={styles.statValue}>{formatCAD(totalAssets, 0)}</Text>
          </View>
        </View>
        <View style={[styles.netWorthStat, { marginLeft: 24 }]}>
          <View style={[styles.statDot, { backgroundColor: C.negative }]} />
          <View>
            <Text style={styles.statLabel}>Liabilities</Text>
            <Text style={styles.statValue}>{formatCAD(totalLiabilities, 0)}</Text>
          </View>
        </View>
      </View>
      <View style={styles.divider} />
      <View style={styles.monthlyRow}>
        <View style={styles.monthlyStat}>
          <Ionicons name="arrow-down-outline" size={14} color={C.positive} />
          <Text style={styles.monthlyLabel}>Income</Text>
          <Text style={styles.monthlyValue}>{formatCAD(monthlyIncome, 0)}</Text>
        </View>
        <View style={styles.monthlyStat}>
          <Ionicons name="arrow-up-outline" size={14} color={C.negative} />
          <Text style={styles.monthlyLabel}>Expenses</Text>
          <Text style={styles.monthlyValue}>{formatCAD(monthlyExpenses, 0)}</Text>
        </View>
        <View style={styles.monthlyStat}>
          <Ionicons name="trending-up-outline" size={14} color={C.gold} />
          <Text style={styles.monthlyLabel}>Savings Rate</Text>
          <Text style={[styles.monthlyValue, { color: C.gold }]}>{savingsRate}%</Text>
        </View>
      </View>
    </LinearGradient>
  );
}

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { user } = useAuth();
  const { isPro, openPaywall } = usePro();
  const { accounts, transactions, netWorth, monthlyIncome, monthlyExpenses, addTransaction, updateTransaction, deleteTransaction } = useFinance();

  const [showAddTx, setShowAddTx] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [showAllTx, setShowAllTx] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showScenarioModal, setShowScenarioModal] = useState(false);
  const [showStatementUpload, setShowStatementUpload] = useState(false);
  const [trajectoryYears, setTrajectoryYears] = useState(5);
  const [showCustomPeriod, setShowCustomPeriod] = useState(false);
  const [customPeriodText, setCustomPeriodText] = useState("");
  const [activeGoalId, setActiveGoalId] = useState<string | null>(null);

  const topPad = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;
  const chartWidth = Math.min(screenWidth - 40, 520);

  // Load goals from Firestore
  const loadGoals = useCallback(async () => {
    if (!user) return;
    try {
      const snap = await getDocs(collection(db, "users", user.id, "goals"));
      setGoals(
        snap.docs.map((d) => ({
          id: d.id,
          name: d.data().name,
          targetAmount: d.data().targetAmount,
          targetDate: d.data().targetDate,
        }))
      );
    } catch {
      // goals are non-critical
    }
  }, [user]);

  useEffect(() => { loadGoals(); }, [loadGoals]);

  const handleAddGoal = async (name: string, targetAmount: number, targetDate: string) => {
    if (!user) return;
    const ref = await addDoc(collection(db, "users", user.id, "goals"), {
      name, targetAmount, targetDate,
      createdAt: new Date().toISOString(),
    });
    setGoals((prev) => [...prev, { id: ref.id, name, targetAmount, targetDate }]);
  };

  const handleDeleteGoal = (goalId: string) => {
    if (!user) return;
    Alert.alert("Remove Goal", "Remove this goal from the chart?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive", onPress: async () => {
          await deleteDoc(doc(db, "users", user.id, "goals", goalId));
          setGoals((prev) => prev.filter((g) => g.id !== goalId));
        },
      },
    ]);
  };

  // Derive chart points
  const historicalPoints = deriveMonthlyNetWorth(transactions, netWorth, 5);
  const avgMonthlySavings = monthlyIncome - monthlyExpenses;
  const lastHistPoint = historicalPoints[historicalPoints.length - 1] ?? { date: new Date(), value: netWorth };
  const projectedMonths = trajectoryYears * 12;
  const projectedPoints = projectNetWorth(lastHistPoint, avgMonthlySavings, projectedMonths);

  const applyCustomPeriod = useCallback(() => {
    const years = parseInt(customPeriodText, 10);
    if (!isNaN(years) && years >= 1 && years <= 100) {
      setTrajectoryYears(years);
      setShowCustomPeriod(false);
      setCustomPeriodText("");
      setActiveGoalId(null);
    }
  }, [customPeriodText]);

  const handleGoalPress = useCallback((g: Goal) => {
    const [yearStr, monthStr] = g.targetDate.split("-");
    const targetYear = parseInt(yearStr, 10);
    const targetMonth = parseInt(monthStr, 10) - 1;
    const now = new Date();
    const monthsToGoal = (targetYear - now.getFullYear()) * 12 + (targetMonth - now.getMonth());
    const years = Math.max(1, Math.min(100, Math.ceil(monthsToGoal / 12)));
    setTrajectoryYears(years);
    setActiveGoalId(g.id);
    setShowCustomPeriod(false);
  }, []);

  const uncategorizedCount = transactions.filter(
    (t) => t.category === "Other" || !t.category
  ).length;

  const filteredTx = categoryFilter
    ? transactions.filter((t) => t.category === categoryFilter)
    : transactions;
  const displayTx = showAllTx ? filteredTx : filteredTx.slice(0, 8);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.headerTitle}>Thrive</Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable onPress={() => setShowAddTx(true)} style={styles.headerActionBtn}>
            <Ionicons name="add" size={22} color={C.tint} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/(tabs)/settings")}
            style={styles.mapleContainer}
          >
            <Ionicons name="leaf" size={18} color={C.tint} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, Platform.OS === "web" && { paddingBottom: 34 }]}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
      >
        <NetWorthCard />

        {!isPro && (
          <Pressable onPress={openPaywall} style={styles.proBanner}>
            <Ionicons name="sparkles" size={14} color={C.tint} />
            <Text style={styles.proBannerText}>Unlock Thrive Pro — Bank sync, AI coach & more</Text>
            <Ionicons name="chevron-forward" size={14} color={C.tint} />
          </Pressable>
        )}

        {/* Net Worth Trajectory */}
        <LockedFeature
          locked={!isPro}
          title="Wealth Trajectory"
          subtitle="Upgrade to Pro to project your net worth"
          onUnlock={openPaywall}
        >
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { flex: 1 }]}>Wealth Trajectory</Text>
            <View style={styles.trajectoryActions}>
              <Pressable
                style={styles.trajectoryBtn}
                onPress={() => setShowScenarioModal(true)}
              >
                <Ionicons name="analytics-outline" size={14} color={C.tint} />
                <Text style={styles.trajectoryBtnText}>What if?</Text>
              </Pressable>
              <Pressable
                style={styles.trajectoryBtn}
                onPress={() => setShowGoalModal(true)}
              >
                <Ionicons name="flag-outline" size={14} color={C.tint} />
                <Text style={styles.trajectoryBtnText}>Set Goal</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.chartCard}>
            {/* Period selector */}
            <View style={styles.periodSelector}>
              {PERIOD_PRESETS.map((p) => {
                const isActive = p.years === 0
                  ? showCustomPeriod
                  : !showCustomPeriod && !activeGoalId && trajectoryYears === p.years;
                return (
                  <Pressable
                    key={p.label}
                    style={[styles.periodBtn, isActive && styles.periodBtnActive]}
                    onPress={() => {
                      if (p.years === 0) {
                        setShowCustomPeriod(true);
                        setCustomPeriodText(String(trajectoryYears));
                        setActiveGoalId(null);
                      } else {
                        setTrajectoryYears(p.years);
                        setShowCustomPeriod(false);
                        setActiveGoalId(null);
                      }
                    }}
                  >
                    <Text style={[styles.periodBtnText, isActive && styles.periodBtnTextActive]}>
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Custom year input */}
            {showCustomPeriod && (
              <View style={styles.customPeriodRow}>
                <TextInput
                  style={styles.customPeriodInput}
                  value={customPeriodText}
                  onChangeText={setCustomPeriodText}
                  placeholder="Years (1–100)"
                  placeholderTextColor={C.textMuted}
                  keyboardType="number-pad"
                  maxLength={3}
                  returnKeyType="done"
                  onSubmitEditing={applyCustomPeriod}
                />
                <Pressable style={styles.customPeriodApply} onPress={applyCustomPeriod}>
                  <Text style={styles.customPeriodApplyText}>Apply</Text>
                </Pressable>
                <Pressable
                  onPress={() => setShowCustomPeriod(false)}
                  style={styles.customPeriodCancel}
                >
                  <Ionicons name="close" size={16} color={C.textMuted} />
                </Pressable>
              </View>
            )}

            <NetWorthChart
              historicalPoints={historicalPoints}
              projectedPoints={projectedPoints}
              goals={goals}
              width={chartWidth}
              totalProjectedMonths={projectedMonths}
            />
            <View style={styles.chartLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendLine, { backgroundColor: C.tint }]} />
                <Text style={styles.legendText}>Historical</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendLineDashed, { borderColor: C.gold }]} />
                <Text style={[styles.legendText, { color: C.gold }]}>Projected</Text>
              </View>
              {goals.length > 0 && (
                <View style={styles.legendItem}>
                  <View style={[styles.legendLineDashed, { borderColor: C.gold, opacity: 0.7 }]} />
                  <Text style={[styles.legendText, { color: C.gold }]}>Goal</Text>
                </View>
              )}
            </View>

            {goals.length > 0 && (
              <View style={styles.goalsList}>
                {goals.map((g) => {
                  const isActiveGoal = activeGoalId === g.id;
                  return (
                    <Pressable
                      key={g.id}
                      style={[styles.goalRow, isActiveGoal && styles.goalRowActive]}
                      onPress={() => handleGoalPress(g)}
                      onLongPress={() => handleDeleteGoal(g.id)}
                      delayLongPress={600}
                    >
                      <View style={[styles.goalDot, isActiveGoal && styles.goalDotActive]} />
                      <Text style={styles.goalName} numberOfLines={1}>{g.name}</Text>
                      <Text style={styles.goalTarget}>{formatCAD(g.targetAmount, 0)}</Text>
                      <Text style={[styles.goalDate, isActiveGoal && { color: C.gold }]}>{g.targetDate}</Text>
                      {isActiveGoal && (
                        <Ionicons name="trending-up-outline" size={13} color={C.gold} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        </View>
        </LockedFeature>

        {/* Uncategorized banner */}
        {uncategorizedCount > 0 && (
          <Pressable
            style={styles.uncategorizedBanner}
            onPress={() => setCategoryFilter(categoryFilter === "Other" ? null : "Other")}
          >
            <View style={styles.uncategorizedBannerLeft}>
              <Ionicons name="alert-circle" size={18} color={C.gold} />
              <Text style={styles.uncategorizedBannerText}>
                {uncategorizedCount} transaction{uncategorizedCount !== 1 ? "s" : ""} need categorizing
              </Text>
            </View>
            <Text style={styles.uncategorizedBannerAction}>
              {categoryFilter === "Other" ? "Show all" : "Review"}
            </Text>
          </Pressable>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Accounts</Text>
          {accounts.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="card-outline" size={28} color={C.textMuted} />
              <Text style={styles.emptyText}>No accounts yet — go to Accounts tab to add some</Text>
            </View>
          ) : (
            accounts.map((account) => <AccountCard key={account.id} account={account} />)
          )}
        </View>

<View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionTitle}>Transactions</Text>
              {categoryFilter && (
                <Text style={styles.filterActive}>Filtered: {categoryFilter}</Text>
              )}
            </View>
            <View style={styles.sectionHeaderActions}>
              {categoryFilter && (
                <Pressable onPress={() => setCategoryFilter(null)} style={styles.clearFilterBtn}>
                  <Ionicons name="close-circle" size={16} color={C.textMuted} />
                </Pressable>
              )}
              <Pressable onPress={() => setShowStatementUpload(true)} style={styles.uploadStmtBtn}>
                <Ionicons name="cloud-upload-outline" size={16} color={C.tint} />
                <Text style={styles.addTxText}>Upload</Text>
              </Pressable>
              <Pressable onPress={() => setShowAddTx(true)} style={styles.addTxBtn}>
                <Ionicons name="add-circle-outline" size={18} color={C.tint} />
                <Text style={styles.addTxText}>Add</Text>
              </Pressable>
            </View>
          </View>

          {filteredTx.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="receipt-outline" size={28} color={C.textMuted} />
              <Text style={styles.emptyText}>
                {categoryFilter ? `No "${categoryFilter}" transactions` : "No transactions yet — tap Add to create one"}
              </Text>
            </View>
          ) : (
            <View style={styles.txContainer}>
              {displayTx.map((tx, i) => (
                <View key={tx.id}>
                  <TransactionRow
                    tx={tx}
                    onEdit={() => setEditingTx(tx)}
                    onDelete={async () => {
                      Alert.alert("Delete Transaction", `Delete "${tx.description}"?`, [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete", style: "destructive",
                          onPress: () => deleteTransaction(tx.id),
                        },
                      ]);
                    }}
                  />
                  {i < displayTx.length - 1 && <View style={styles.txDivider} />}
                </View>
              ))}
              {filteredTx.length > 8 && (
                <Pressable style={styles.showMoreBtn} onPress={() => setShowAllTx((v) => !v)}>
                  <Text style={styles.showMoreText}>
                    {showAllTx ? "Show less" : `Show all ${filteredTx.length} transactions`}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <GoalModal
        visible={showGoalModal}
        onSave={handleAddGoal}
        onClose={() => setShowGoalModal(false)}
      />

      <ScenarioModal
        visible={showScenarioModal}
        onClose={() => setShowScenarioModal(false)}
        currentNetWorth={netWorth}
        monthlyIncome={monthlyIncome}
        monthlyExpenses={monthlyExpenses}
        chartWidth={chartWidth}
      />

      <TransactionModal
        visible={showAddTx}
        onSave={async (data) => { await addTransaction({ ...data, accountId: accounts[0]?.id || "" }); }}
        onClose={() => setShowAddTx(false)}
      />

      {editingTx && (
        <TransactionModal
          visible
          initial={editingTx}
          onSave={async (data) => { await updateTransaction(editingTx.id, data); }}
          onClose={() => setEditingTx(null)}
        />
      )}

      <StatementUploadModal
        visible={showStatementUpload}
        onClose={() => setShowStatementUpload(false)}
        onImport={async (txs) => {
          for (const tx of txs) {
            await addTransaction({
              description: tx.description,
              amount: tx.amount,
              category: tx.category,
              date: tx.date,
              accountId: accounts[0]?.id || "",
            });
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  greeting: { fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textMuted, letterSpacing: 0.3 },
  headerTitle: { fontFamily: "DM_Sans_700Bold", fontSize: 28, color: C.text, letterSpacing: -0.5 },
  headerRight: { flexDirection: "row", gap: 8 },
  headerActionBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: `${C.tint}18`, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: `${C.tint}30` },
  mapleContainer: { width: 40, height: 40, borderRadius: 20, backgroundColor: `${C.tint}18`, alignItems: "center", justifyContent: "center" },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 120, gap: 24 },

  // Net worth card
  netWorthCard: { borderRadius: 20, padding: 22, borderWidth: 1, borderColor: Colors.palette.green700, overflow: "hidden" },
  netWorthHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  netWorthLabel: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.textSecondary, letterSpacing: 0.5, textTransform: "uppercase" },
  cadBadge: { backgroundColor: `${C.tint}22`, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  cadBadgeText: { fontFamily: "DM_Sans_700Bold", fontSize: 10, color: C.tint, letterSpacing: 1 },
  netWorthAmount: { fontFamily: "DM_Sans_700Bold", fontSize: 42, color: C.text, letterSpacing: -1.5, marginBottom: 16 },
  netWorthRow: { flexDirection: "row", marginBottom: 16 },
  netWorthStat: { flexDirection: "row", alignItems: "center", gap: 8 },
  statDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.positive },
  statLabel: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted },
  statValue: { fontFamily: "DM_Sans_600SemiBold", fontSize: 15, color: C.text },
  divider: { height: 1, backgroundColor: Colors.palette.green700, marginBottom: 14 },
  monthlyRow: { flexDirection: "row", justifyContent: "space-between" },
  monthlyStat: { alignItems: "center", gap: 2 },
  monthlyLabel: { fontFamily: "DM_Sans_400Regular", fontSize: 11, color: C.textMuted },
  monthlyValue: { fontFamily: "DM_Sans_600SemiBold", fontSize: 14, color: C.text },

  // Uncategorized banner
  uncategorizedBanner: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: `${C.gold}15`, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: `${C.gold}30`,
  },
  uncategorizedBannerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  uncategorizedBannerText: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.gold },
  uncategorizedBannerAction: { fontFamily: "DM_Sans_600SemiBold", fontSize: 13, color: C.gold },

  // Sections
  section: { gap: 10 },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  sectionHeaderActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontFamily: "DM_Sans_600SemiBold", fontSize: 17, color: C.text, marginBottom: 2, flexShrink: 1 },
  filterActive: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.tint },
  clearFilterBtn: { padding: 2 },
  addTxBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  uploadStmtBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginRight: 6 },
  addTxText: { fontFamily: "DM_Sans_500Medium", fontSize: 14, color: C.tint },

  // Accounts
  accountCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  accountCardInner: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  accountDot: { width: 10, height: 10, borderRadius: 5 },
  accountInfo: { flex: 1, gap: 3 },
  accountName: { fontFamily: "DM_Sans_600SemiBold", fontSize: 15, color: C.text },
  accountMeta: { flexDirection: "row", gap: 6, alignItems: "center" },
  accountInstitution: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted },
  accountType: { fontFamily: "DM_Sans_500Medium", fontSize: 11, color: C.tint, backgroundColor: `${C.tint}18`, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  accountBalance: { fontFamily: "DM_Sans_700Bold", fontSize: 16, color: C.text },

  // Empty states
  emptyCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 24, alignItems: "center", gap: 10 },
  emptyText: { fontFamily: "DM_Sans_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center" },

  // Transactions
  txContainer: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  txRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  txDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 16 },
  txIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  txInfo: { flex: 1, gap: 3 },
  txDescription: { fontFamily: "DM_Sans_500Medium", fontSize: 14, color: C.text },
  txMeta: { flexDirection: "row", alignItems: "center" },
  txCategory: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted },
  txDate: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted },
  txAmount: { fontFamily: "DM_Sans_600SemiBold", fontSize: 14 },
  uncategorizedBadge: { flexDirection: "row", alignItems: "center", gap: 3 },
  uncategorizedText: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.gold },
  showMoreBtn: { padding: 14, alignItems: "center" },
  showMoreText: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.tint },

  // Transaction modal
  txModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  txModalCard: { backgroundColor: C.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: Platform.OS === "web" ? 34 : 48, borderTopWidth: 1, borderTopColor: C.border, gap: 16, maxHeight: "90%" },
  txModalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  txModalTitle: { fontFamily: "DM_Sans_700Bold", fontSize: 20, color: C.text },
  txTypeRow: { flexDirection: "row", gap: 10 },
  txTypeBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: "center" },
  txTypeBtnActive: { backgroundColor: `${C.negative}20`, borderColor: C.negative },
  txTypeBtnActivePos: { backgroundColor: `${C.positive}20`, borderColor: C.positive },
  txTypeText: { fontFamily: "DM_Sans_500Medium", fontSize: 14, color: C.textSecondary },
  txTypeTextActive: { color: C.negative, fontFamily: "DM_Sans_600SemiBold" },
  txTypeTextActivePos: { color: C.positive, fontFamily: "DM_Sans_600SemiBold" },
  txFormFields: { gap: 14 },
  txField: { gap: 6 },
  txFieldLabel: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.textSecondary },
  txInput: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 12, fontFamily: "DM_Sans_400Regular", fontSize: 15, color: C.text },
  txAmountRow: { flexDirection: "row", alignItems: "center", backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingLeft: 14 },
  txDollarSign: { fontFamily: "DM_Sans_600SemiBold", fontSize: 18, color: C.textSecondary, marginRight: 2 },

  // Category picker
  txCategoryPicker: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 12 },
  catPickerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  txCategoryPickerText: { fontFamily: "DM_Sans_400Regular", fontSize: 15, color: C.text },
  customBadge: { backgroundColor: `${C.tint}20`, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  customBadgeText: { fontFamily: "DM_Sans_500Medium", fontSize: 10, color: C.tint },
  catPickerDropdown: { backgroundColor: C.elevated, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginTop: 6, padding: 12, gap: 8 },
  catGroupLabel: { fontFamily: "DM_Sans_600SemiBold", fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, marginTop: 8 },
  catGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  catChipSelected: { backgroundColor: C.tint, borderColor: C.tint },
  catChipText: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.textSecondary },
  catChipTextSelected: { color: "#000" },
  addCustomCatBtn: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: `${C.tint}30`, borderStyle: "dashed" },
  addCustomCatText: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.tint },
  customCatRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  customCatInput: { flex: 1, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.tint, paddingHorizontal: 12, paddingVertical: 10, fontFamily: "DM_Sans_400Regular", fontSize: 14, color: C.text },
  customCatSaveBtn: { backgroundColor: C.tint, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  customCatSaveText: { fontFamily: "DM_Sans_600SemiBold", fontSize: 14, color: "#000" },

  // Modal actions
  txModalActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  txCancelBtn: { flex: 1, backgroundColor: C.elevated, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  txCancelText: { fontFamily: "DM_Sans_500Medium", fontSize: 15, color: C.textSecondary },
  txSaveBtn: { flex: 1, backgroundColor: C.tint, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  txSaveText: { fontFamily: "DM_Sans_600SemiBold", fontSize: 15, color: "#000" },

  // Pro banner
  proBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: `${C.tint}10`, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: `${C.tint}25`,
  },
  proBannerText: { flex: 1, fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.tint },

  // Trajectory
trajectoryActions: { flexDirection: "row", gap: 8 },
  trajectoryBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: `${C.tint}15`, borderWidth: 1, borderColor: `${C.tint}30` },
  trajectoryBtnText: { fontFamily: "DM_Sans_500Medium", fontSize: 12, color: C.tint },
  chartCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  periodSelector: { flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, flexWrap: "wrap" },
  periodBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    backgroundColor: C.elevated, borderWidth: 1, borderColor: C.border,
  },
  periodBtnActive: { backgroundColor: C.tint, borderColor: C.tint },
  periodBtnText: { fontFamily: "DM_Sans_500Medium", fontSize: 12, color: C.textSecondary },
  periodBtnTextActive: { color: "#000", fontFamily: "DM_Sans_600SemiBold" },
  customPeriodRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingBottom: 10,
  },
  customPeriodInput: {
    flex: 1, backgroundColor: C.elevated, borderRadius: 8, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 7,
    fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.text,
  },
  customPeriodApply: {
    backgroundColor: C.tint, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  customPeriodApplyText: { fontFamily: "DM_Sans_600SemiBold", fontSize: 13, color: "#000" },
  customPeriodCancel: { padding: 4 },
  chartLegend: { flexDirection: "row", gap: 16, paddingHorizontal: 16, paddingBottom: 12, paddingTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendLine: { width: 20, height: 2.5, borderRadius: 2 },
  legendLineDashed: { width: 20, height: 0, borderTopWidth: 2, borderStyle: "dashed" },
  legendText: { fontFamily: "DM_Sans_400Regular", fontSize: 11, color: C.textMuted },
  goalsList: { borderTopWidth: 1, borderTopColor: C.border },
  goalRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 10 },
  goalRowActive: { backgroundColor: `${C.gold}0D` },
  goalDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.gold, borderWidth: 1, borderStyle: "dashed", borderColor: C.gold },
  goalDotActive: { backgroundColor: C.gold, borderStyle: "solid" },
  goalName: { flex: 1, fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.text },
  goalTarget: { fontFamily: "DM_Sans_600SemiBold", fontSize: 13, color: C.tint },
  goalDate: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted, minWidth: 58, textAlign: "right" },
});

// Chart platform fallback styles
const chartStyles = StyleSheet.create({
  webFallback: { padding: 20, alignItems: "center" },
  webFallbackLabel: { fontFamily: "DM_Sans_500Medium", fontSize: 14, color: C.textSecondary },
});

// Goal modal styles
const goalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 24 },
  card: { backgroundColor: C.card, borderRadius: 20, padding: 24, width: "100%", maxWidth: 360, borderWidth: 1, borderColor: C.border, gap: 14 },
  title: { fontFamily: "DM_Sans_700Bold", fontSize: 20, color: C.text },
  subtitle: { fontFamily: "DM_Sans_400Regular", fontSize: 14, color: C.textSecondary, marginTop: -6 },
  field: { gap: 6 },
  label: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.textSecondary },
  input: { backgroundColor: C.elevated, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 11, fontFamily: "DM_Sans_400Regular", fontSize: 15, color: C.text },
  amountRow: { flexDirection: "row", alignItems: "center", backgroundColor: C.elevated, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingLeft: 14 },
  dollarSign: { fontFamily: "DM_Sans_600SemiBold", fontSize: 18, color: C.textSecondary, marginRight: 2 },
  actions: { flexDirection: "row", gap: 10 },
  cancelBtn: { flex: 1, backgroundColor: C.elevated, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  cancelText: { fontFamily: "DM_Sans_500Medium", fontSize: 15, color: C.textSecondary },
  saveBtn: { flex: 1, backgroundColor: C.tint, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  saveText: { fontFamily: "DM_Sans_600SemiBold", fontSize: 15, color: "#000" },
});