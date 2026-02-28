import React, { useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
} from "react-native-reanimated";
import Colors from "@/constants/colors";
import { useFinance, Account } from "@/context/FinanceContext";

const C = Colors.dark;

function formatCAD(amount: number, decimals = 2): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-CA", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

function AccountTypeLabel({ type }: { type: Account["type"] }) {
  const labels: Record<Account["type"], string> = {
    chequing: "Chequing",
    savings: "Savings",
    tfsa: "TFSA",
    rrsp: "RRSP",
    fhsa: "FHSA",
    resp: "RESP",
    investment: "Investment",
    credit: "Credit",
  };
  return <Text style={styles.accountType}>{labels[type]}</Text>;
}

function AccountCard({ account }: { account: Account }) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const isNegative = account.balance < 0;

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
        <Text style={[styles.accountBalance, isNegative && { color: C.negative }]}>
          {formatCAD(account.balance)}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

interface TransactionRowProps {
  description: string;
  category: string;
  date: string;
  amount: number;
}

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Groceries: "basket-outline",
  Dining: "restaurant-outline",
  Transport: "car-outline",
  Entertainment: "film-outline",
  Shopping: "bag-outline",
  Utilities: "flash-outline",
  Health: "medical-outline",
  Income: "arrow-down-circle-outline",
};

function TransactionRow({ description, category, date, amount }: TransactionRowProps) {
  const isPositive = amount > 0;
  const icon = CATEGORY_ICONS[category] ?? "ellipse-outline";
  const d = new Date(date);
  const dateStr = d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });

  return (
    <View style={styles.txRow}>
      <View style={[styles.txIcon, { backgroundColor: isPositive ? `${C.positive}22` : `${C.tint}18` }]}>
        <Ionicons name={icon} size={17} color={isPositive ? C.positive : C.tint} />
      </View>
      <View style={styles.txInfo}>
        <Text style={styles.txDescription} numberOfLines={1}>{description}</Text>
        <Text style={styles.txCategory}>{category} · {dateStr}</Text>
      </View>
      <Text style={[styles.txAmount, { color: isPositive ? C.positive : C.textPrimary }]}>
        {isPositive ? "+" : ""}{formatCAD(amount)}
      </Text>
    </View>
  );
}

function NetWorthCard() {
  const { netWorth, totalAssets, totalLiabilities, monthlyIncome, monthlyExpenses } = useFinance();
  const savingsRate = monthlyIncome > 0
    ? Math.round(((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100)
    : 0;

  return (
    <LinearGradient
      colors={["#0F3D28", "#0A2818", "#080F0C"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.netWorthCard}
    >
      <View style={styles.netWorthHeader}>
        <Text style={styles.netWorthLabel}>Net Worth</Text>
        <View style={styles.cadBadge}>
          <Text style={styles.cadBadgeText}>CAD</Text>
        </View>
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
  const { accounts, transactions } = useFinance();
  const recentTx = transactions.slice(0, 6);

  const topPad = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good morning</Text>
          <Text style={styles.headerTitle}>Thrive</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.mapleContainer}>
            <Ionicons name="leaf" size={18} color={C.tint} />
          </View>
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
        <NetWorthCard />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Accounts</Text>
          {accounts.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          <View style={styles.txContainer}>
            {recentTx.map((tx) => (
              <TransactionRow
                key={tx.id}
                description={tx.description}
                category={tx.category}
                date={tx.date}
                amount={tx.amount}
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  greeting: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 13,
    color: C.textMuted,
    letterSpacing: 0.3,
  },
  headerTitle: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 28,
    color: C.text,
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: "row",
    gap: 8,
  },
  mapleContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: `${Colors.dark.tint}18`,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 120,
    gap: 24,
  },
  netWorthCard: {
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: Colors.palette.green700,
    overflow: "hidden",
  },
  netWorthHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  netWorthLabel: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 13,
    color: C.textSecondary,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  cadBadge: {
    backgroundColor: `${C.tint}22`,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  cadBadgeText: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 10,
    color: C.tint,
    letterSpacing: 1,
  },
  netWorthAmount: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 42,
    color: C.text,
    letterSpacing: -1.5,
    marginBottom: 16,
  },
  netWorthRow: {
    flexDirection: "row",
    marginBottom: 16,
  },
  netWorthStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.positive,
  },
  statLabel: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 12,
    color: C.textMuted,
  },
  statValue: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 15,
    color: C.text,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.palette.green700,
    marginBottom: 14,
  },
  monthlyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  monthlyStat: {
    alignItems: "center",
    gap: 2,
  },
  monthlyLabel: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 11,
    color: C.textMuted,
  },
  monthlyValue: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 14,
    color: C.text,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 17,
    color: C.text,
    marginBottom: 2,
  },
  accountCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  accountCardInner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  accountDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  accountInfo: {
    flex: 1,
    gap: 3,
  },
  accountName: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 15,
    color: C.text,
  },
  accountMeta: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  accountInstitution: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 12,
    color: C.textMuted,
  },
  accountType: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 11,
    color: C.tint,
    backgroundColor: `${C.tint}18`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  accountBalance: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 16,
    color: C.text,
  },
  txContainer: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  txInfo: {
    flex: 1,
    gap: 2,
  },
  txDescription: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 14,
    color: C.text,
  },
  txCategory: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 12,
    color: C.textMuted,
  },
  txAmount: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 14,
    color: C.text,
  },
});
