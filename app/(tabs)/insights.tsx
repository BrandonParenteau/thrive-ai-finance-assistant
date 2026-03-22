import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
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
  Keyboard,
  LayoutAnimation,
  UIManager,
  Animated,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { doc, getDoc } from "firebase/firestore";
import { router, useFocusEffect } from "expo-router";
import { Swipeable } from "react-native-gesture-handler";
import Colors from "@/constants/colors";
import { useFinance } from "@/context/FinanceContext";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { usePro } from "@/hooks/usePro";
import LockedFeature from "@/components/LockedFeature";
import {
  tfsaCumulativeRoom,
  fhsaCumulativeRoom,
  estimateTax,
  type TaxProfile,
  DEFAULT_TAX_PROFILE,
} from "@/utils/canadianTaxRates";
import type { BudgetItem, Transaction } from "@/context/FinanceContext";

if (Platform.OS === "android") {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

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

// ─── Skeleton Loader ────────────────────────────────────────────────────────

function SkeletonRows() {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.75, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 650, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={{ paddingBottom: 4 }}>
      {[70, 55, 80].map((w, i) => (
        <Animated.View key={i} style={[styles.skeletonRow, { opacity }]}>
          <View style={[styles.skeletonBar, { flex: 1 }]} />
          <View style={[styles.skeletonBar, { width: w }]} />
          <View style={[styles.skeletonBar, { width: 44 }]} />
        </Animated.View>
      ))}
    </View>
  );
}

// ─── Plaid Transaction Row ───────────────────────────────────────────────────

function PlaidTransactionRow({
  tx,
  showMove,
  onMove,
}: {
  tx: Transaction;
  showMove?: boolean;
  onMove?: () => void;
}) {
  const date = new Date(tx.date);
  const dateStr = date.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  const isCredit = tx.amount > 0;
  const displayName = tx.merchant || tx.description;

  return (
    <View style={styles.plaidTxRow}>
      <Text style={styles.plaidTxName} numberOfLines={1}>{displayName}</Text>
      <Text style={styles.plaidTxDate}>{dateStr}</Text>
      <View style={styles.plaidTxRight}>
        <Text style={[styles.plaidTxAmount, { color: isCredit ? C.positive : C.negative }]}>
          {isCredit ? "+" : ""}{formatCAD(Math.abs(tx.amount))}
        </Text>
        {showMove && (
          <Pressable style={styles.movePill} onPress={onMove} hitSlop={6}>
            <Text style={styles.movePillText}>Move</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ─── Budget Item Row ────────────────────────────────────────────────────────

function BudgetItemRow({
  item,
  spent,
  onEdit,
  onDelete,
}: {
  item: BudgetItem;
  spent: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const pct = item.budgetedAmount > 0 ? Math.min(spent / item.budgetedAmount, 1) : 0;
  const isOver = spent > item.budgetedAmount;
  const isClose = !isOver && pct > 0.8;
  const spentColor = isOver ? C.negative : isClose ? C.gold : C.tint;
  const swipeRef = useRef<Swipeable>(null);

  const renderRightActions = () => (
    <Pressable
      style={styles.swipeDeleteAction}
      onPress={() => { swipeRef.current?.close(); onDelete(); }}
    >
      <Ionicons name="trash-outline" size={18} color="#fff" />
      <Text style={styles.swipeDeleteText}>Delete</Text>
    </Pressable>
  );

  return (
    <Swipeable ref={swipeRef} renderRightActions={renderRightActions} overshootRight={false}>
      <Pressable style={styles.itemRow} onPress={onEdit}>
        <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.itemBudgeted}>{formatCAD(item.budgetedAmount)} budgeted</Text>
        <Text style={[styles.itemSpent, { color: spentColor }]}>{formatCAD(spent)}</Text>
      </Pressable>
      <View style={styles.itemBarTrack}>
        <View style={[styles.itemBarFill, { width: `${pct * 100}%` as any, backgroundColor: spentColor }]} />
      </View>
    </Swipeable>
  );
}

// ─── Expandable Budget Row ──────────────────────────────────────────────────

function ExpandableBudgetRow({
  budget,
  items,
  spentPerItem,
  unmatchedSpend,
  isExpanded,
  isPlaidConnected,
  categoryTransactions,
  onToggle,
  onEditBudget,
  onSetLimit,
  onAddItem,
  onEditItem,
  onDeleteItem,
  onMoveTx,
}: {
  budget: { category: string; limit: number; spent: number };
  items: BudgetItem[];
  spentPerItem: Record<string, number>;
  unmatchedSpend: number;
  isExpanded: boolean;
  isPlaidConnected: boolean;
  categoryTransactions: Transaction[];
  onToggle: () => void;
  onEditBudget: () => void;
  onSetLimit: () => void;
  onAddItem: () => void;
  onEditItem: (item: BudgetItem) => void;
  onDeleteItem: (id: string) => void;
  onMoveTx: (tx: Transaction) => void;
}) {
  const [showSkeleton, setShowSkeleton] = useState(false);

  // Brief skeleton flash on first expand
  useEffect(() => {
    if (isExpanded && isPlaidConnected) {
      setShowSkeleton(true);
      const t = setTimeout(() => setShowSkeleton(false), 400);
      return () => clearTimeout(t);
    }
  }, [isExpanded]);

  const hasItems = items.length > 0;
  const displayLimit = hasItems ? items.reduce((s, i) => s + i.budgetedAmount, 0) : budget.limit;
  const displaySpent = budget.spent;

  const pct = displayLimit > 0 ? Math.min(displaySpent / displayLimit, 1) : 0;
  const isOver = displayLimit > 0 && displaySpent > displayLimit;
  const barColor = isOver ? C.negative : pct > 0.8 ? C.gold : C.tint;
  const remaining = Math.max(displayLimit - displaySpent, 0);
  const icon = CATEGORY_ICONS[budget.category] ?? "ellipse-outline";

  const remainingText = () => {
    if (isOver) return <Text style={{ color: C.negative }}>{formatCAD(displaySpent - displayLimit)} over budget</Text>;
    if (isPlaidConnected && displaySpent === 0) return <Text style={{ color: C.textMuted }}>$0 spent · No activity</Text>;
    if (!isPlaidConnected && hasItems && displayLimit === 0) return <Text style={{ color: C.textMuted }}>Set up items to track</Text>;
    return <Text style={{ color: C.textMuted }}>{formatCAD(remaining)} remaining</Text>;
  };

  return (
    <View>
      <Pressable style={styles.budgetRow} onPress={onToggle}>
        <View style={[styles.budgetIcon, { backgroundColor: `${barColor}20` }]}>
          <Ionicons name={icon} size={16} color={barColor} />
        </View>
        <View style={styles.budgetInfo}>
          <View style={styles.budgetHeader}>
            <Text style={styles.budgetCategory}>{budget.category}</Text>
            <View style={styles.budgetHeaderRight}>
              {displayLimit > 0 ? (
                <Text style={[styles.budgetSpent, isOver && { color: C.negative }]}>
                  {formatCAD(displaySpent)} / {formatCAD(displayLimit)}
                </Text>
              ) : (
                <Text style={styles.budgetSpent}>{formatCAD(displaySpent)} spent</Text>
              )}
              {budget.limit === 0 ? (
                <Pressable onPress={onSetLimit} hitSlop={8}>
                  <Text style={styles.setLimitLabel}>Set limit</Text>
                </Pressable>
              ) : (
                <Pressable onPress={onEditBudget} style={styles.editBudgetBtn} hitSlop={8}>
                  <Ionicons name="pencil-outline" size={13} color={C.textMuted} />
                </Pressable>
              )}
              <Ionicons
                name="chevron-forward"
                size={14}
                color={C.textMuted}
                style={{ transform: [{ rotate: isExpanded ? "90deg" : "0deg" }] }}
              />
            </View>
          </View>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${pct * 100}%` as any, backgroundColor: barColor }]} />
          </View>
          <Text style={styles.budgetRemaining}>{remainingText()}</Text>
        </View>
      </Pressable>

      {isExpanded && (
        <View style={styles.expandedSection}>
          {isOver && (
            <View style={styles.overspentBanner}>
              <Ionicons name="warning-outline" size={14} color={C.negative} />
              <Text style={styles.overspentBannerText}>
                Over budget by {formatCAD(displaySpent - displayLimit)} this month
              </Text>
            </View>
          )}

          {isPlaidConnected ? (
            showSkeleton ? (
              <SkeletonRows />
            ) : categoryTransactions.length === 0 ? (
              <View style={styles.plaidNoActivity}>
                <Text style={styles.plaidNoActivityText}>No transactions this month</Text>
              </View>
            ) : (
              categoryTransactions.map((tx, i) => (
                <View key={tx.id}>
                  {i > 0 && <View style={styles.itemSeparator} />}
                  <PlaidTransactionRow tx={tx} />
                </View>
              ))
            )
          ) : (
            <>
              {items.length === 0 ? (
                <View style={styles.itemEmptyState}>
                  <View style={styles.itemEmptyIcon}>
                    <Ionicons name="add" size={16} color={C.tint} />
                  </View>
                  <Text style={styles.itemEmptyText}>No items tracked yet</Text>
                  <Pressable style={styles.addItemOutlineBtn} onPress={onAddItem}>
                    <Text style={styles.addItemOutlineBtnText}>+ Add Budget Item</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  {items.map((item, i) => (
                    <View key={item.id}>
                      {i > 0 && <View style={styles.itemSeparator} />}
                      <BudgetItemRow
                        item={item}
                        spent={spentPerItem[item.id] ?? 0}
                        onEdit={() => onEditItem(item)}
                        onDelete={() => onDeleteItem(item.id)}
                      />
                    </View>
                  ))}
                  {unmatchedSpend > 0 && (
                    <>
                      <View style={styles.itemSeparator} />
                      <View style={styles.unmatchedRow}>
                        <Ionicons name="help-circle-outline" size={14} color={C.gold} />
                        <Text style={styles.unmatchedLabel}>Not budgeted</Text>
                        <Text style={styles.unmatchedAmount}>{formatCAD(unmatchedSpend)}</Text>
                      </View>
                      <View style={styles.itemBarTrack}>
                        <View style={[styles.itemBarFill, { width: "100%" as any, backgroundColor: C.gold }]} />
                      </View>
                    </>
                  )}
                  <Pressable style={styles.addItemInlineBtn} onPress={onAddItem}>
                    <Ionicons name="add-circle-outline" size={14} color={C.tint} />
                    <Text style={styles.addItemInlineBtnText}>Add Item</Text>
                  </Pressable>
                </>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Not Budgeted Row ────────────────────────────────────────────────────────

function NotBudgetedRow({
  transactions,
  isExpanded,
  onToggle,
  onMoveTx,
}: {
  transactions: Transaction[];
  isExpanded: boolean;
  onToggle: () => void;
  onMoveTx: (tx: Transaction) => void;
}) {
  const [showSkeleton, setShowSkeleton] = useState(false);
  const totalSpent = transactions.reduce((s, t) => s + Math.abs(t.amount), 0);

  useEffect(() => {
    if (isExpanded) {
      setShowSkeleton(true);
      const t = setTimeout(() => setShowSkeleton(false), 400);
      return () => clearTimeout(t);
    }
  }, [isExpanded]);

  return (
    <View>
      <Pressable style={styles.budgetRow} onPress={onToggle}>
        <View style={[styles.budgetIcon, { backgroundColor: `${C.textMuted}20` }]}>
          <Ionicons name="help-circle-outline" size={16} color={C.textMuted} />
        </View>
        <View style={styles.budgetInfo}>
          <View style={styles.budgetHeader}>
            <Text style={[styles.budgetCategory, { color: C.textSecondary }]}>Not Budgeted</Text>
            <View style={styles.budgetHeaderRight}>
              <Text style={styles.budgetSpent}>{formatCAD(totalSpent)} spent</Text>
              <Ionicons
                name="chevron-forward"
                size={14}
                color={C.textMuted}
                style={{ transform: [{ rotate: isExpanded ? "90deg" : "0deg" }] }}
              />
            </View>
          </View>
          <Text style={[styles.budgetRemaining, { color: C.textMuted }]}>
            {transactions.length} transaction{transactions.length !== 1 ? "s" : ""} from untracked categories
          </Text>
        </View>
      </Pressable>

      {isExpanded && (
        <View style={styles.expandedSection}>
          {showSkeleton ? (
            <SkeletonRows />
          ) : transactions.length === 0 ? (
            <View style={styles.plaidNoActivity}>
              <Text style={styles.plaidNoActivityText}>No untracked transactions</Text>
            </View>
          ) : (
            transactions.map((tx, i) => (
              <View key={tx.id}>
                {i > 0 && <View style={styles.itemSeparator} />}
                <PlaidTransactionRow tx={tx} showMove onMove={() => onMoveTx(tx)} />
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

// ─── Move Category Modal ─────────────────────────────────────────────────────

function MoveCategoryModal({
  visible,
  transaction,
  categories,
  onMove,
  onClose,
}: {
  visible: boolean;
  transaction: Transaction | null;
  categories: string[];
  onMove: (txId: string, category: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={bsStyles.overlay} onPress={onClose} />
      <View style={[bsStyles.sheet, { paddingBottom: Math.max(insets.bottom, 24), maxHeight: "60%" }]}>
        <View style={bsStyles.handle} />
        <Text style={bsStyles.title}>Move to Category</Text>
        {transaction && (
          <Text style={bsStyles.fieldLabel}>{transaction.merchant || transaction.description}</Text>
        )}
        <ScrollView showsVerticalScrollIndicator={false} style={{ marginHorizontal: -24 }}>
          {categories.map((cat, i) => (
            <View key={cat}>
              {i > 0 && <View style={styles.rowDivider} />}
              <Pressable
                style={styles.moveCatRow}
                onPress={() => { if (transaction) onMove(transaction.id, cat); onClose(); }}
              >
                <View style={[styles.moveCatIcon, { backgroundColor: `${CATEGORY_COLORS[cat] ?? C.textMuted}20` }]}>
                  <Ionicons name={CATEGORY_ICONS[cat] ?? "ellipse-outline"} size={16} color={CATEGORY_COLORS[cat] ?? C.textMuted} />
                </View>
                <Text style={styles.moveCatName}>{cat}</Text>
                <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Set Limit Modal ─────────────────────────────────────────────────────────

function SetLimitModal({
  visible,
  category,
  onSave,
  onClose,
}: {
  visible: boolean;
  category: string;
  onSave: (limit: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!visible) setValue("");
  }, [visible]);

  useEffect(() => {
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

  const handleSave = () => {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) { Alert.alert("Invalid", "Enter a valid amount"); return; }
    onSave(num);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={bsStyles.overlay} onPress={onClose} />
      <View style={[bsStyles.sheet, { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 16 : Math.max(insets.bottom, 24) }]}>
        <View style={bsStyles.handle} />
        <Text style={bsStyles.title}>Set Monthly Limit</Text>
        <Text style={bsStyles.fieldLabel}>{category}</Text>
        <View style={bsStyles.amountRow}>
          <Text style={bsStyles.dollarSign}>$</Text>
          <TextInput
            style={bsStyles.amountInput}
            placeholder="0.00"
            placeholderTextColor={C.textMuted}
            value={value}
            onChangeText={setValue}
            keyboardType="decimal-pad"
            autoFocus
          />
        </View>
        <Pressable style={bsStyles.saveBtn} onPress={handleSave}>
          <Text style={bsStyles.saveBtnText}>Save</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// ─── Spending Pie Chart ─────────────────────────────────────────────────────

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

// ─── Edit Budget Modal ──────────────────────────────────────────────────────

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
        <Pressable style={styles.modalCard} onPress={() => Keyboard.dismiss()}>
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

// ─── Edit Income Modal ──────────────────────────────────────────────────────

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
        <Pressable style={styles.modalCard} onPress={() => Keyboard.dismiss()}>
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

// ─── Add / Edit Budget Item Modal (bottom sheet) ────────────────────────────

function AddBudgetItemModal({
  visible,
  initialCategory,
  editingItem,
  categories,
  onSave,
  onClose,
}: {
  visible: boolean;
  initialCategory: string;
  editingItem: BudgetItem | null;
  categories: string[];
  onSave: (data: { name: string; budgetedAmount: number; categoryId: string }) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState(initialCategory);
  const [nameError, setNameError] = useState("");
  const [amountError, setAmountError] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
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

  useEffect(() => {
    if (visible) {
      if (editingItem) {
        setName(editingItem.name);
        setAmount(editingItem.budgetedAmount.toString());
        setCategoryId(editingItem.categoryId);
      } else {
        setName("");
        setAmount("");
        setCategoryId(initialCategory);
      }
      setNameError("");
      setAmountError("");
    }
  }, [visible, editingItem, initialCategory]);

  const handleSave = () => {
    let valid = true;
    if (!name.trim()) { setNameError("Item name is required"); valid = false; }
    else setNameError("");
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) { setAmountError("Enter a valid amount"); valid = false; }
    else setAmountError("");
    if (!valid) return;
    onSave({ name: name.trim(), budgetedAmount: num, categoryId });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={bsStyles.overlay} onPress={onClose} />
      <View style={[bsStyles.sheet, { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 16 : Math.max(insets.bottom, 24) }]}>
        <View style={bsStyles.handle} />
        <Text style={bsStyles.title}>{editingItem ? "Edit Budget Item" : "Add Budget Item"}</Text>

        <Text style={bsStyles.fieldLabel}>Item Name</Text>
        <TextInput
          style={[bsStyles.input, !!nameError && bsStyles.inputError]}
          placeholder="e.g. Netflix, Groceries, Gas"
          placeholderTextColor={C.textMuted}
          value={name}
          onChangeText={(t) => { setName(t); if (nameError) setNameError(""); }}
          autoFocus={!editingItem}
          returnKeyType="next"
        />
        {!!nameError && <Text style={bsStyles.errorText}>{nameError}</Text>}

        <Text style={bsStyles.fieldLabel}>Monthly Budget</Text>
        <View style={[bsStyles.amountRow, !!amountError && bsStyles.inputError]}>
          <Text style={bsStyles.dollarSign}>$</Text>
          <TextInput
            style={bsStyles.amountInput}
            placeholder="0.00"
            placeholderTextColor={C.textMuted}
            value={amount}
            onChangeText={(t) => { setAmount(t); if (amountError) setAmountError(""); }}
            keyboardType="decimal-pad"
          />
        </View>
        {!!amountError && <Text style={bsStyles.errorText}>{amountError}</Text>}

        <Text style={bsStyles.fieldLabel}>Category</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={bsStyles.categoryScroll}
          contentContainerStyle={bsStyles.categoryScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {categories.map((cat) => (
            <Pressable
              key={cat}
              style={[bsStyles.categoryPill, categoryId === cat && bsStyles.categoryPillActive]}
              onPress={() => setCategoryId(cat)}
            >
              <Text style={[bsStyles.categoryPillText, categoryId === cat && bsStyles.categoryPillTextActive]}>
                {cat}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={bsStyles.actions}>
          <Pressable style={bsStyles.cancelBtn} onPress={onClose}>
            <Text style={bsStyles.cancelBtnText}>Cancel</Text>
          </Pressable>
          <Pressable style={bsStyles.saveBtn} onPress={handleSave}>
            <Text style={bsStyles.saveBtnText}>{editingItem ? "Update Item" : "Save Item"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─── Registered Account Card ────────────────────────────────────────────────

const REGISTERED_ACCOUNT_COLORS: Record<string, string> = {
  tfsa: C.tint, rrsp: "#56CFE1", fhsa: C.gold, resp: "#C77DFF",
};
const REGISTERED_ACCOUNT_LABELS: Record<string, string> = {
  tfsa: "TFSA", rrsp: "RRSP", fhsa: "FHSA", resp: "RESP",
};
const REGISTERED_ACCOUNT_DESCRIPTIONS: Record<string, string> = {
  tfsa: "Tax-Free Savings Account",
  rrsp: "Registered Retirement Savings Plan",
  fhsa: "First Home Savings Account",
  resp: "Registered Education Savings Plan",
};

function RegisteredAccountCard({
  type, balance, contributionRoom, lifetime, lifetimeLabel, onPress,
}: {
  type: string; balance: number; contributionRoom: number;
  lifetime?: number; lifetimeLabel?: string; onPress?: () => void;
}) {
  const color = REGISTERED_ACCOUNT_COLORS[type] ?? C.tint;
  const label = REGISTERED_ACCOUNT_LABELS[type] ?? type.toUpperCase();
  const desc = REGISTERED_ACCOUNT_DESCRIPTIONS[type] ?? "";
  const usedPct = lifetime && lifetime > 0 ? Math.min(balance / lifetime, 1) : 0;
  const roomPct = lifetime && lifetime > 0 ? contributionRoom / lifetime : 0;

  return (
    <Pressable style={taxStyles.regCard} onPress={onPress}>
      <View style={taxStyles.regCardHeader}>
        <View style={[taxStyles.regBadge, { backgroundColor: `${color}20` }]}>
          <Text style={[taxStyles.regBadgeText, { color }]}>{label}</Text>
        </View>
        <Text style={taxStyles.regBalance}>{formatCAD(balance)}</Text>
      </View>
      <Text style={taxStyles.regDesc}>{desc}</Text>
      {lifetime && (
        <View style={taxStyles.regBarWrap}>
          <View style={[taxStyles.regBarFill, { width: `${usedPct * 100}%` as any, backgroundColor: color }]} />
          {roomPct > 0 && (
            <View style={[taxStyles.regBarRoom, { width: `${Math.min(roomPct, 1 - usedPct) * 100}%` as any, backgroundColor: `${color}40` }]} />
          )}
        </View>
      )}
      <View style={taxStyles.regFooter}>
        {type === "rrsp" && contributionRoom === 0 && !lifetime ? (
          <Text style={[taxStyles.regRoomText, { color: C.textMuted }]}>
            Set your RRSP room in Settings → Tax Profile
          </Text>
        ) : (
          <View style={taxStyles.regRoomRow}>
            <View style={[taxStyles.regRoomDot, { backgroundColor: color }]} />
            <Text style={taxStyles.regRoomText}>
              {formatCAD(contributionRoom, 0)} contribution room available
            </Text>
          </View>
        )}
        {lifetime && (
          <Text style={taxStyles.regLifetime}>{lifetimeLabel ?? "Lifetime"}: {formatCAD(lifetime, 0)}</Text>
        )}
      </View>
    </Pressable>
  );
}

// ─── AI Optimization Card ───────────────────────────────────────────────────

function AIOptimizationCard({
  taxProfile, annualIncome, tfsaRoom, rrspRoom, fhsaRoom,
}: {
  taxProfile: TaxProfile; annualIncome: number;
  tfsaRoom: number; rrspRoom: number; fhsaRoom: number;
}) {
  const tax = estimateTax(annualIncome, taxProfile.province);
  const marginalPct = Math.round(tax.marginalCombined * 100);
  const rrspSaving = Math.round(Math.min(rrspRoom, 5000) * tax.marginalCombined);
  const tfsaFirst = tax.marginalCombined < 0.26;

  const insights: { icon: keyof typeof Ionicons.glyphMap; tip: string; color: string }[] = [];

  if (rrspRoom > 0 && annualIncome > 0) {
    insights.push({
      icon: "trending-down-outline",
      tip: `Contributing $5,000 to your RRSP saves ~${formatCAD(rrspSaving, 0)} in taxes at your ${marginalPct}% marginal rate.`,
      color: "#56CFE1",
    });
  }
  if (tfsaRoom > 0) {
    insights.push({
      icon: tfsaFirst ? "star-outline" : "swap-horizontal-outline",
      tip: tfsaFirst
        ? `At ${marginalPct}% marginal rate, maximize your TFSA first — tax-free growth beats RRSP deduction at lower incomes.`
        : `At ${marginalPct}% marginal rate, prioritize RRSP over TFSA — the upfront deduction is more valuable.`,
      color: C.tint,
    });
  }
  if (fhsaRoom > 0) {
    insights.push({
      icon: "home-outline",
      tip: `You have ${formatCAD(fhsaRoom, 0)} FHSA room. Contributions are tax-deductible AND withdrawals for a first home are tax-free — use it before RRSP.`,
      color: C.gold,
    });
  }
  if (insights.length === 0) {
    insights.push({
      icon: "checkmark-circle-outline",
      tip: "Complete your Tax Profile in Settings to get personalized optimization tips.",
      color: C.textMuted,
    });
  }

  return (
    <View style={taxStyles.aiCard}>
      <View style={taxStyles.aiCardHeader}>
        <View style={taxStyles.aiCardTitleRow}>
          <Ionicons name="sparkles" size={16} color={C.tint} />
          <Text style={taxStyles.aiCardTitle}>AI Tax Optimization</Text>
        </View>
        <Pressable style={taxStyles.aiAskBtn} onPress={() => router.push("/(tabs)/assistant")}>
          <Text style={taxStyles.aiAskBtnText}>Ask Thrive →</Text>
        </Pressable>
      </View>
      <View style={taxStyles.aiInsights}>
        {insights.map((ins, i) => (
          <View key={i} style={taxStyles.aiInsightRow}>
            <View style={[taxStyles.aiInsightIcon, { backgroundColor: `${ins.color}18` }]}>
              <Ionicons name={ins.icon} size={15} color={ins.color} />
            </View>
            <Text style={taxStyles.aiInsightText}>{ins.tip}</Text>
          </View>
        ))}
      </View>
      {annualIncome > 0 && (
        <View style={taxStyles.taxSummaryRow}>
          <View style={taxStyles.taxSummaryItem}>
            <Text style={taxStyles.taxSummaryLabel}>Annual Income</Text>
            <Text style={taxStyles.taxSummaryValue}>{formatCAD(annualIncome, 0)}</Text>
          </View>
          <View style={taxStyles.taxSummaryItem}>
            <Text style={taxStyles.taxSummaryLabel}>Marginal Rate</Text>
            <Text style={taxStyles.taxSummaryValue}>{marginalPct}%</Text>
          </View>
          <View style={taxStyles.taxSummaryItem}>
            <Text style={taxStyles.taxSummaryLabel}>Effective Rate</Text>
            <Text style={taxStyles.taxSummaryValue}>{Math.round(tax.effectiveRate * 100)}%</Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Insights Screen ────────────────────────────────────────────────────────

export default function InsightsScreen() {
  const insets = useSafeAreaInsets();
  const {
    transactions, budgets, accounts, monthlyIncome, monthlyExpenses, setBudgets,
    budgetItems, addBudgetItem, updateBudgetItem, deleteBudgetItem, updateTransaction,
  } = useFinance();
  const { user, updateProfile } = useAuth();
  const { isPro, openPaywall } = usePro();

  const [editingBudget, setEditingBudget] = useState<{ category: string; limit: number } | null>(null);
  const [editingIncome, setEditingIncome] = useState(false);
  const [taxProfile, setTaxProfile] = useState<TaxProfile>(DEFAULT_TAX_PROFILE);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingBudgetItem, setEditingBudgetItem] = useState<BudgetItem | null>(null);
  const [itemModalCategory, setItemModalCategory] = useState("");
  // Plaid-specific state
  const [movingTx, setMovingTx] = useState<Transaction | null>(null);
  const [setLimitFor, setSetLimitFor] = useState<string | null>(null);
  const [notBudgetedExpanded, setNotBudgetedExpanded] = useState(false);

  const loadTaxProfile = useCallback(async () => {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, "users", user.id));
      if (snap.exists() && snap.data().tax_profile) {
        setTaxProfile({ ...DEFAULT_TAX_PROFILE, ...snap.data().tax_profile });
      }
    } catch {
      // non-critical
    }
  }, [user]);

  useFocusEffect(useCallback(() => { loadTaxProfile(); }, [loadTaxProfile]));

  const topPad = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;

  // Plaid connection: any account with a plaidAccountId is Plaid-connected
  const isPlaidConnected = useMemo(() => accounts.some((a) => !!a.plaidAccountId), [accounts]);

  // Last sync = most recent lastUpdated among Plaid accounts
  const plaidLastSync = useMemo(() => {
    const plaidAccounts = accounts.filter((a) => !!a.plaidAccountId);
    if (plaidAccounts.length === 0) return null;
    const ts = plaidAccounts.reduce((max, a) => {
      const t = new Date(a.lastUpdated).getTime();
      return t > max ? t : max;
    }, 0);
    return ts > 0 ? ts : null;
  }, [accounts]);

  const syncLabel = useMemo(() => {
    if (!plaidLastSync) return "Syncing...";
    const d = new Date(plaidLastSync);
    const dateStr = d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
    const timeStr = d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
    return `Last synced · ${dateStr} at ${timeStr}`;
  }, [plaidLastSync]);

  // Days until end of month
  const daysUntilReset = useMemo(() => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return lastDay - now.getDate();
  }, []);

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

  // Current month transactions grouped by category (for Plaid view)
  const currentMonthTxsByCategory = useMemo(() => {
    const map: Record<string, Transaction[]> = {};
    const now = new Date();
    const cm = now.getMonth(), cy = now.getFullYear();
    transactions
      .filter((t) => {
        const d = new Date(t.date);
        return d.getMonth() === cm && d.getFullYear() === cy && t.amount < 0;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .forEach((t) => {
        if (!map[t.category]) map[t.category] = [];
        map[t.category].push(t);
      });
    return map;
  }, [transactions]);

  // Not budgeted: current month transactions whose category isn't in any budget
  const notBudgetedTxs = useMemo(() => {
    if (!isPlaidConnected) return [];
    const budgetCatSet = new Set(budgets.map((b) => b.category));
    const now = new Date();
    const cm = now.getMonth(), cy = now.getFullYear();
    return transactions
      .filter((t) => {
        const d = new Date(t.date);
        return d.getMonth() === cm && d.getFullYear() === cy && t.amount < 0 && !budgetCatSet.has(t.category);
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, budgets, isPlaidConnected]);

  // Per-item spent amounts (manual mode)
  const itemSpentMap = useMemo(() => {
    const map: Record<string, number> = {};
    const now = new Date();
    const cm = now.getMonth(), cy = now.getFullYear();
    const monthTxs = transactions.filter((t) => {
      const d = new Date(t.date);
      return d.getMonth() === cm && d.getFullYear() === cy && t.amount < 0;
    });
    budgetItems.forEach((item) => {
      const nameLC = item.name.toLowerCase();
      map[item.id] = monthTxs
        .filter((t) =>
          t.category === item.categoryId &&
          (t.merchant?.toLowerCase().includes(nameLC) || t.description.toLowerCase().includes(nameLC))
        )
        .reduce((s, t) => s + Math.abs(t.amount), 0);
    });
    return map;
  }, [budgetItems, transactions]);

  const itemsByCategory = useMemo(() => {
    const map: Record<string, BudgetItem[]> = {};
    budgetItems.forEach((item) => {
      if (!map[item.categoryId]) map[item.categoryId] = [];
      map[item.categoryId].push(item);
    });
    return map;
  }, [budgetItems]);

  const unmatchedSpendByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    budgets.forEach((b) => {
      const items = itemsByCategory[b.category] ?? [];
      if (items.length === 0) { map[b.category] = 0; return; }
      const matchedTotal = items.reduce((s, i) => s + (itemSpentMap[i.id] ?? 0), 0);
      map[b.category] = Math.max(b.spent - matchedTotal, 0);
    });
    return map;
  }, [budgets, itemsByCategory, itemSpentMap]);

  // Registered accounts
  const registeredAccounts = accounts.filter((a) => ["tfsa", "rrsp", "fhsa", "resp"].includes(a.type));
  const tfsaBalance = accounts.filter((a) => a.type === "tfsa").reduce((s, a) => s + a.balance, 0);
  const rrspBalance = accounts.filter((a) => a.type === "rrsp").reduce((s, a) => s + a.balance, 0);
  const fhsaBalance = accounts.filter((a) => a.type === "fhsa").reduce((s, a) => s + a.balance, 0);

  const currentYear = new Date().getFullYear();
  const annualIncome = monthlyIncome * 12;
  const tfsaLifetime = tfsaCumulativeRoom(taxProfile.birthYear, currentYear);
  const tfsaRoom = Math.max(tfsaLifetime - tfsaBalance, 0);
  const rrspRoom = Math.max(taxProfile.rrspAvailableRoom, 0);
  const fhsaLifetime = taxProfile.fhsaYearOpened ? fhsaCumulativeRoom(taxProfile.fhsaYearOpened, currentYear) : 0;
  const fhsaRoom = Math.max(fhsaLifetime - fhsaBalance, 0);

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

  const toggleCategory = useCallback((category: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const openAddItem = useCallback((category: string) => {
    setEditingBudgetItem(null);
    setItemModalCategory(category);
    setShowItemModal(true);
  }, []);

  const openEditItem = useCallback((item: BudgetItem) => {
    setEditingBudgetItem(item);
    setItemModalCategory(item.categoryId);
    setShowItemModal(true);
  }, []);

  const handleSaveItem = useCallback(async (data: { name: string; budgetedAmount: number; categoryId: string }) => {
    if (editingBudgetItem) {
      await updateBudgetItem(editingBudgetItem.id, { name: data.name, budgetedAmount: data.budgetedAmount, categoryId: data.categoryId });
    } else {
      await addBudgetItem(data);
    }
  }, [editingBudgetItem, addBudgetItem, updateBudgetItem]);

  const handleDeleteItem = useCallback(async (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    await deleteBudgetItem(id);
  }, [deleteBudgetItem]);

  const handleMoveTransaction = useCallback(async (txId: string, category: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    await updateTransaction(txId, { category });
  }, [updateTransaction]);

  const now = new Date();
  const monthName = now.toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  const budgetCategories = budgets.map((b) => b.category);

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
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
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
            <View style={styles.budgetMetaRow}>
              <Text style={styles.resetsLabel}>Resets in {daysUntilReset} day{daysUntilReset !== 1 ? "s" : ""}</Text>
              {isPlaidConnected && (
                <Text style={styles.syncLabel}>{syncLabel}</Text>
              )}
            </View>
            <View style={styles.card}>
              {budgets.map((b, i) => (
                <View key={b.category}>
                  <ExpandableBudgetRow
                    budget={b}
                    items={itemsByCategory[b.category] ?? []}
                    spentPerItem={itemSpentMap}
                    unmatchedSpend={unmatchedSpendByCategory[b.category] ?? 0}
                    isExpanded={expandedCategories.has(b.category)}
                    isPlaidConnected={isPlaidConnected}
                    categoryTransactions={currentMonthTxsByCategory[b.category] ?? []}
                    onToggle={() => toggleCategory(b.category)}
                    onEditBudget={() => setEditingBudget({ category: b.category, limit: b.limit })}
                    onSetLimit={() => setSetLimitFor(b.category)}
                    onAddItem={() => openAddItem(b.category)}
                    onEditItem={openEditItem}
                    onDeleteItem={handleDeleteItem}
                    onMoveTx={setMovingTx}
                  />
                  {i < budgets.length - 1 && <View style={styles.rowDivider} />}
                </View>
              ))}
              {isPlaidConnected && notBudgetedTxs.length > 0 && (
                <>
                  <View style={styles.rowDivider} />
                  <NotBudgetedRow
                    transactions={notBudgetedTxs}
                    isExpanded={notBudgetedExpanded}
                    onToggle={() => {
                      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                      setNotBudgetedExpanded((v) => !v);
                    }}
                    onMoveTx={setMovingTx}
                  />
                </>
              )}
            </View>
          </View>
        )}

        {/* ── Registered Accounts ── */}
        <LockedFeature
          locked={!isPro}
          title="Canadian Tax Intelligence"
          subtitle="Upgrade to Pro for TFSA, RRSP, and FHSA insights"
          onUnlock={openPaywall}
        >
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Registered Accounts</Text>
              <Pressable style={taxStyles.taxProfileBtn} onPress={() => router.push("/(tabs)/settings")}>
                <Ionicons name="settings-outline" size={13} color={C.textMuted} />
                <Text style={taxStyles.taxProfileBtnText}>Tax Profile</Text>
              </Pressable>
            </View>

            {registeredAccounts.length === 0 ? (
              <View style={[styles.card, { padding: 20, alignItems: "center", gap: 8 }]}>
                <Ionicons name="shield-checkmark-outline" size={28} color={C.textMuted} />
                <Text style={{ fontFamily: "DM_Sans_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center" }}>
                  No TFSA, RRSP, FHSA, or RESP accounts yet.{"\n"}Add them in the Accounts tab.
                </Text>
              </View>
            ) : (
              <View style={taxStyles.regGrid}>
                {accounts.filter((a) => a.type === "tfsa").length > 0 && (
                  <RegisteredAccountCard type="tfsa" balance={tfsaBalance} contributionRoom={tfsaRoom} lifetime={tfsaLifetime} />
                )}
                {accounts.filter((a) => a.type === "rrsp").length > 0 && (
                  <RegisteredAccountCard type="rrsp" balance={rrspBalance} contributionRoom={rrspRoom} onPress={() => router.push("/(tabs)/settings")} />
                )}
                {accounts.filter((a) => a.type === "fhsa").length > 0 && (
                  <RegisteredAccountCard type="fhsa" balance={fhsaBalance} contributionRoom={fhsaRoom} lifetime={fhsaLifetime || undefined} />
                )}
                {accounts.filter((a) => a.type === "resp").length > 0 && (
                  <RegisteredAccountCard
                    type="resp"
                    balance={accounts.filter((a) => a.type === "resp").reduce((s, a) => s + a.balance, 0)}
                    contributionRoom={50000 - accounts.filter((a) => a.type === "resp").reduce((s, a) => s + a.balance, 0)}
                    lifetime={50000}
                  />
                )}
              </View>
            )}

            <AIOptimizationCard
              taxProfile={taxProfile}
              annualIncome={annualIncome}
              tfsaRoom={tfsaRoom}
              rrspRoom={rrspRoom}
              fhsaRoom={fhsaRoom}
            />
          </View>
        </LockedFeature>

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
            { icon: "time-outline" as const, tip: "RRSP deadline is March 2. Contributions reduce your taxable income for the prior year." },
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

      {!isPlaidConnected && (
        <AddBudgetItemModal
          visible={showItemModal}
          initialCategory={itemModalCategory}
          editingItem={editingBudgetItem}
          categories={budgetCategories}
          onSave={handleSaveItem}
          onClose={() => { setShowItemModal(false); setEditingBudgetItem(null); }}
        />
      )}

      <SetLimitModal
        visible={!!setLimitFor}
        category={setLimitFor ?? ""}
        onSave={(limit) => { if (setLimitFor) handleBudgetSave(setLimitFor, limit); }}
        onClose={() => setSetLimitFor(null)}
      />

      <MoveCategoryModal
        visible={!!movingTx}
        transaction={movingTx}
        categories={budgetCategories}
        onMove={handleMoveTransaction}
        onClose={() => setMovingTx(null)}
      />
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

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
  budgetMetaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: -4 },
  resetsLabel: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted, fontVariant: ["tabular-nums"] },
  syncLabel: { fontFamily: "DM_Sans_400Regular", fontSize: 11, color: C.textMuted, fontVariant: ["tabular-nums"] },
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
  // Budget rows
  budgetRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  budgetIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  budgetInfo: { flex: 1, gap: 4 },
  budgetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  budgetHeaderRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  editBudgetBtn: { padding: 2 },
  setLimitLabel: { fontFamily: "DM_Sans_500Medium", fontSize: 12, color: C.textMuted },
  budgetCategory: { fontFamily: "DM_Sans_500Medium", fontSize: 14, color: C.text },
  budgetSpent: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.textSecondary },
  barTrack: { height: 6, backgroundColor: C.elevated, borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },
  budgetRemaining: { fontFamily: "DM_Sans_400Regular", fontSize: 12 },
  rowDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 16 },
  // Expanded section
  expandedSection: { backgroundColor: `${C.elevated}60`, paddingBottom: 4 },
  itemSeparator: { height: 1, backgroundColor: C.border, opacity: 0.06, marginHorizontal: 16 },
  // Manual item rows
  itemRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, gap: 8, backgroundColor: `${C.elevated}60` },
  itemName: { flex: 1, fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.text },
  itemBudgeted: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted },
  itemSpent: { fontFamily: "DM_Sans_600SemiBold", fontSize: 13, minWidth: 44, textAlign: "right" },
  itemBarTrack: { height: 3, backgroundColor: C.elevated, marginHorizontal: 16, marginBottom: 8, borderRadius: 2, overflow: "hidden" },
  itemBarFill: { height: "100%", borderRadius: 2 },
  swipeDeleteAction: { backgroundColor: C.negative, justifyContent: "center", alignItems: "center", width: 80, gap: 4 },
  swipeDeleteText: { fontFamily: "DM_Sans_500Medium", fontSize: 11, color: "#fff" },
  itemEmptyState: { alignItems: "center", paddingVertical: 20, paddingHorizontal: 16, gap: 8, backgroundColor: `${C.elevated}60` },
  itemEmptyIcon: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: `${C.tint}50`, alignItems: "center", justifyContent: "center" },
  itemEmptyText: { fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textMuted },
  addItemOutlineBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: `${C.tint}60`, marginTop: 4 },
  addItemOutlineBtnText: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.tint },
  addItemInlineBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: `${C.elevated}60` },
  addItemInlineBtnText: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.tint },
  overspentBanner: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: `${C.negative}12`, borderBottomWidth: 1, borderBottomColor: `${C.negative}20` },
  overspentBannerText: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.negative, flex: 1 },
  unmatchedRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, backgroundColor: `${C.elevated}60` },
  unmatchedLabel: { flex: 1, fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.gold },
  unmatchedAmount: { fontFamily: "DM_Sans_600SemiBold", fontSize: 13, color: C.gold },
  // Plaid transaction rows
  plaidTxRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 11, backgroundColor: `${C.elevated}60`, gap: 8 },
  plaidTxName: { flex: 1, fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.text },
  plaidTxDate: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted, fontVariant: ["tabular-nums"], minWidth: 44, textAlign: "center" },
  plaidTxRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  plaidTxAmount: { fontFamily: "DM_Sans_600SemiBold", fontSize: 13, minWidth: 52, textAlign: "right", fontVariant: ["tabular-nums"] },
  movePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.elevated },
  movePillText: { fontFamily: "DM_Sans_500Medium", fontSize: 11, color: C.textSecondary },
  plaidNoActivity: { paddingVertical: 16, paddingHorizontal: 16, backgroundColor: `${C.elevated}60`, alignItems: "center" },
  plaidNoActivityText: { fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textMuted },
  // Skeleton
  skeletonRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 8, backgroundColor: `${C.elevated}60` },
  skeletonBar: { height: 10, borderRadius: 5, backgroundColor: C.elevated },
  // Move category modal rows
  moveCatRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  moveCatIcon: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  moveCatName: { flex: 1, fontFamily: "DM_Sans_500Medium", fontSize: 14, color: C.text },
  // Portfolio
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
  // Modals
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

const taxStyles = StyleSheet.create({
  taxProfileBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  taxProfileBtnText: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted },
  regGrid: { gap: 10 },
  regCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16, gap: 8 },
  regCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  regBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  regBadgeText: { fontFamily: "DM_Sans_700Bold", fontSize: 12, letterSpacing: 0.5 },
  regBalance: { fontFamily: "DM_Sans_700Bold", fontSize: 18, color: C.text, letterSpacing: -0.5 },
  regDesc: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted },
  regBarWrap: { height: 6, backgroundColor: C.elevated, borderRadius: 3, flexDirection: "row", overflow: "hidden" },
  regBarFill: { height: "100%", borderRadius: 3 },
  regBarRoom: { height: "100%" },
  regFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  regRoomRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  regRoomDot: { width: 6, height: 6, borderRadius: 3 },
  regRoomText: { fontFamily: "DM_Sans_500Medium", fontSize: 12, color: C.textSecondary },
  regLifetime: { fontFamily: "DM_Sans_400Regular", fontSize: 11, color: C.textMuted },
  aiCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: `${C.tint}25`, overflow: "hidden" },
  aiCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, paddingBottom: 10 },
  aiCardTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  aiCardTitle: { fontFamily: "DM_Sans_600SemiBold", fontSize: 14, color: C.text },
  aiAskBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: `${C.tint}15` },
  aiAskBtnText: { fontFamily: "DM_Sans_600SemiBold", fontSize: 12, color: C.tint },
  aiInsights: { paddingHorizontal: 14, paddingBottom: 12, gap: 10 },
  aiInsightRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  aiInsightIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 1 },
  aiInsightText: { flex: 1, fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  taxSummaryRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: C.border },
  taxSummaryItem: { flex: 1, alignItems: "center", paddingVertical: 10, gap: 2 },
  taxSummaryLabel: { fontFamily: "DM_Sans_400Regular", fontSize: 11, color: C.textMuted },
  taxSummaryValue: { fontFamily: "DM_Sans_700Bold", fontSize: 14, color: C.text },
});

// ─── Bottom Sheet Styles ────────────────────────────────────────────────────

const bsStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: C.border,
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 12,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: 4 },
  title: { fontFamily: "DM_Sans_700Bold", fontSize: 20, color: C.text, marginBottom: 4 },
  fieldLabel: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.textSecondary, marginBottom: -4 },
  input: {
    backgroundColor: C.elevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 15,
    color: C.text,
  },
  inputError: { borderColor: C.negative },
  errorText: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.negative, marginTop: -6 },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.elevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
  },
  dollarSign: { fontFamily: "DM_Sans_700Bold", fontSize: 20, color: C.textSecondary, marginRight: 4 },
  amountInput: { flex: 1, fontFamily: "DM_Sans_700Bold", fontSize: 22, color: C.text, paddingVertical: 12 },
  categoryScroll: { marginHorizontal: -4 },
  categoryScrollContent: { paddingHorizontal: 4, gap: 8, flexDirection: "row" },
  categoryPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.elevated,
  },
  categoryPillActive: { borderColor: C.tint, backgroundColor: `${C.tint}18` },
  categoryPillText: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.textSecondary },
  categoryPillTextActive: { color: C.tint },
  actions: { flexDirection: "row", gap: 10, paddingTop: 4 },
  cancelBtn: { flex: 1, backgroundColor: C.elevated, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  cancelBtnText: { fontFamily: "DM_Sans_500Medium", fontSize: 15, color: C.textSecondary },
  saveBtn: { flex: 1, backgroundColor: C.tint, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveBtnText: { fontFamily: "DM_Sans_600SemiBold", fontSize: 15, color: "#000" },
});
