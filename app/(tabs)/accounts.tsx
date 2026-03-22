import React, { useState, useCallback } from "react";
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
  Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import Colors from "@/constants/colors";
import { useFinance, Account } from "@/context/FinanceContext";
import { useAuth } from "@/context/AuthContext";
import { getFunctionsUrl } from "@/lib/functions";
import { usePro } from "@/hooks/usePro";
import toast from "@/utils/toast";
import { withRetry } from "@/utils/withRetry";
import { mapError, PLAID_MESSAGES, NETWORK_MESSAGES } from "@/utils/errorMessages";
import { setNetworkOffline, setNetworkOnline } from "@/hooks/useNetworkStatus";

const C = Colors.dark;

function formatCAD(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

const ACCOUNT_TYPES: { type: Account["type"]; label: string; description: string }[] = [
  { type: "chequing", label: "Chequing", description: "Day-to-day spending" },
  { type: "savings", label: "Savings", description: "Emergency fund" },
  { type: "tfsa", label: "TFSA", description: "Tax-free savings" },
  { type: "rrsp", label: "RRSP", description: "Retirement savings" },
  { type: "fhsa", label: "FHSA", description: "First home savings" },
  { type: "resp", label: "RESP", description: "Education savings" },
  { type: "investment", label: "Investment", description: "Non-registered" },
  { type: "credit", label: "Credit Card", description: "Credit balance" },
];

const ACCOUNT_COLORS = ["#00D4A0", "#F5C842", "#32C86E", "#6EDDA0", "#FF6B6B", "#56CFE1", "#C77DFF"];
const INSTITUTIONS = ["TD Bank", "RBC", "Scotiabank", "BMO", "CIBC", "National Bank", "Wealthsimple", "Questrade", "EQ Bank", "Tangerine", "Other"];

const TYPE_ICONS: Record<Account["type"], keyof typeof Ionicons.glyphMap> = {
  chequing: "wallet-outline",
  savings: "shield-checkmark-outline",
  tfsa: "leaf-outline",
  rrsp: "time-outline",
  fhsa: "home-outline",
  resp: "school-outline",
  investment: "trending-up-outline",
  credit: "card-outline",
};

/**
 * Maps a Plaid error code (from API response) to a user-friendly alert.
 * Returns null if the error is a user cancellation (no alert needed).
 */
function handlePlaidError(plaidErrorCode: string | undefined, fallbackMessage: string): { title: string; message: string } | null {
  if (!plaidErrorCode) {
    return { title: "Connection Error", message: fallbackMessage };
  }
  // User closed the Plaid Link sheet before completing — treat as cancellation
  if (plaidErrorCode === "USER_CANCELLED" || plaidErrorCode === "EXIT") {
    return null;
  }
  const mapped = PLAID_MESSAGES[plaidErrorCode];
  if (mapped) return { title: mapped.title, message: mapped.message };
  return { title: "Connection Error", message: fallbackMessage };
}

function AccountRow({ account, onEdit, onRemove }: { account: Account; onEdit: () => void; onRemove: () => void }) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const icon = TYPE_ICONS[account.type];
  const isNegative = account.balance < 0;

  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} style={animStyle}>
      <Pressable
        onPressIn={() => { scale.value = withSpring(0.98); }}
        onPressOut={() => { scale.value = withSpring(1); }}
        onPress={onEdit}
        onLongPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          Alert.alert(account.name, "What would you like to do?", [
            { text: "Edit", onPress: onEdit },
            { text: "Remove", style: "destructive", onPress: onRemove },
            { text: "Cancel", style: "cancel" },
          ]);
        }}
        style={styles.accountRow}
      >
        <View style={[styles.accountIcon, { backgroundColor: `${account.color}22` }]}>
          <Ionicons name={icon} size={20} color={account.color} />
        </View>
        <View style={styles.accountInfo}>
          <Text style={styles.accountName}>{account.name}</Text>
          <View style={styles.accountMeta}>
            <Text style={styles.accountInstitution}>{account.institution}</Text>
            <View style={[styles.typeBadge, { backgroundColor: `${account.color}20` }]}>
              <Text style={[styles.typeText, { color: account.color }]}>
                {account.type.toUpperCase()}
              </Text>
            </View>
            {account.plaidAccountId && (
              <View style={styles.plaidBadge}>
                <Text style={styles.plaidBadgeText}>PLAID</Text>
              </View>
            )}
          </View>
        </View>
        <Text style={[styles.balance, isNegative && { color: C.negative }]}>
          {formatCAD(account.balance)}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function AccountModal({
  visible,
  initial,
  onClose,
}: {
  visible: boolean;
  initial?: Account | null;
  onClose: () => void;
}) {
  const { addAccount, updateAccount } = useFinance();
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? "");
  const [institution, setInstitution] = useState(initial?.institution ?? "TD Bank");
  const [selectedType, setSelectedType] = useState<Account["type"]>(initial?.type ?? "chequing");
  const [balance, setBalance] = useState(initial ? String(initial.balance) : "");
  const [selectedColor, setSelectedColor] = useState(initial?.color ?? ACCOUNT_COLORS[0]);
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();

  React.useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setInstitution(initial?.institution ?? "TD Bank");
      setSelectedType(initial?.type ?? "chequing");
      setBalance(initial ? String(initial.balance) : "");
      setSelectedColor(initial?.color ?? ACCOUNT_COLORS[0]);
    }
  }, [visible, initial?.id]);

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert("Name Required", "Please enter an account name."); return; }
    const bal = parseFloat(balance.replace(/[^0-9.-]/g, ""));
    if (isNaN(bal)) { Alert.alert("Invalid Balance", "Please enter a valid dollar amount (e.g. 1500.00)."); return; }
    setLoading(true);
    try {
      if (isEdit && initial) {
        await updateAccount(initial.id, { name: name.trim(), institution, type: selectedType, balance: bal, color: selectedColor });
      } else {
        await addAccount({ name: name.trim(), institution, type: selectedType, balance: bal, color: selectedColor });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (e: any) {
      Alert.alert(e.title ?? "Error", e.message || "Couldn't save the account. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{isEdit ? "Edit Account" : "Add Account"}</Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={C.textSecondary} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 20 }} keyboardShouldPersistTaps="handled" onScrollBeginDrag={Keyboard.dismiss}>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Account Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Everyday Chequing"
              placeholderTextColor={C.textMuted}
              returnKeyType="done"
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Account Type</Text>
            <View style={styles.typeGrid}>
              {ACCOUNT_TYPES.map(({ type, label }) => (
                <Pressable
                  key={type}
                  onPress={() => setSelectedType(type)}
                  style={[styles.typeChip, selectedType === type && styles.typeChipActive]}
                >
                  <Text style={[styles.typeChipText, selectedType === type && { color: C.tint }]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Institution</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {INSTITUTIONS.map((inst) => (
                <Pressable
                  key={inst}
                  onPress={() => setInstitution(inst)}
                  style={[styles.instChip, institution === inst && styles.instChipActive]}
                >
                  <Text style={[styles.instChipText, institution === inst && { color: C.tint }]}>{inst}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Current Balance (CAD)</Text>
            <TextInput
              style={styles.input}
              value={balance}
              onChangeText={setBalance}
              placeholder="0.00"
              placeholderTextColor={C.textMuted}
              keyboardType="numbers-and-punctuation"
              returnKeyType="done"
            />
            {selectedType === "credit" && (
              <Text style={styles.hint}>Enter a negative value for credit card debt (e.g. -2500)</Text>
            )}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Color</Text>
            <View style={styles.colorRow}>
              {ACCOUNT_COLORS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setSelectedColor(c)}
                  style={[styles.colorSwatch, { backgroundColor: c }, selectedColor === c && styles.colorSwatchSelected]}
                />
              ))}
            </View>
          </View>

          <Pressable onPress={handleSave} style={styles.addBtn} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#000" />
              : <><Ionicons name="checkmark" size={20} color="#000" /><Text style={styles.addBtnText}>{isEdit ? "Save Changes" : "Add Account"}</Text></>}
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function AccountsScreen() {
  const insets = useSafeAreaInsets();
  const { accounts, removeAccount, totalAssets, totalLiabilities, refreshAccounts } = useFinance();
  const { token } = useAuth();
  const { isPro, openPaywall } = usePro();
  const [showModal, setShowModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const topPad = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;

  const byType = {
    registered: accounts.filter((a) => ["tfsa", "rrsp", "fhsa", "resp"].includes(a.type)),
    banking: accounts.filter((a) => ["chequing", "savings"].includes(a.type)),
    investments: accounts.filter((a) => a.type === "investment"),
    credit: accounts.filter((a) => a.type === "credit"),
  };

  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const resp = await withRetry(
        () => fetch(`${getFunctionsUrl()}/plaidSyncTransactions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }),
        { maxAttempts: 3, baseDelayMs: 1_000 }
      );

      setNetworkOnline();

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const plaidCode = data.plaid_error_code ?? data.error_code;
        const info = handlePlaidError(plaidCode, data.error || "Couldn't sync transactions. Please try again.");
        if (info) {
          // Login required needs a prompt to reconnect, not just a toast
          if (plaidCode === "ITEM_LOGIN_REQUIRED") {
            Alert.alert(info.title, info.message + "\n\nTap \"Reconnect\" to re-link your bank account.", [
              { text: "Reconnect", onPress: handleConnectPlaid },
              { text: "Dismiss", style: "cancel" },
            ]);
          } else {
            toast.warning(info.message);
          }
        }
        return;
      }

      await refreshAccounts();
      toast.success("Transactions synced successfully.");
    } catch (e) {
      const mapped = mapError(e);
      if (mapped === NETWORK_MESSAGES.OFFLINE) setNetworkOffline();
      toast.error(mapped.message);
    } finally {
      setSyncing(false);
    }
  }, [token, syncing, refreshAccounts]);

  const handleConnectPlaid = useCallback(async () => {
    if (!token) {
      Alert.alert("Sign In Required", "Please sign in before connecting a bank account.");
      return;
    }
    if (connecting) return;
    setConnecting(true);
    try {
      const base = getFunctionsUrl();
      const resp = await withRetry(
        () => fetch(`${base}/plaidLinkToken`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        }),
        { maxAttempts: 2, baseDelayMs: 1_000 }
      );

      setNetworkOnline();

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        const plaidCode = data.plaid_error_code ?? data.error_code;
        const info = handlePlaidError(plaidCode, data.error || "Couldn't start the bank connection. Please try again.");
        if (resp.status === 429) {
          Alert.alert("Too Many Requests", "Too many connection attempts. Please wait a few minutes and try again.");
        } else if (info) {
          Alert.alert(info.title, info.message);
        }
        return;
      }

      if (!data.session_token) {
        Alert.alert("Connection Error", "Couldn't retrieve a valid session token. Please try again.");
        return;
      }

      // Open Plaid Link in browser
      const result = await WebBrowser.openBrowserAsync(
        `${base}/plaidLink?session=${encodeURIComponent(data.session_token)}`
      );

      // WebBrowser returns { type: "cancel" } when user dismisses without completing
      if (result.type === "cancel" || result.type === "dismiss") {
        // User cancelled — no error needed
        return;
      }

      // Refresh accounts after successful link
      await refreshAccounts();

      const newPlaidAccounts = accounts.filter((a) => a.plaidAccountId);
      if (newPlaidAccounts.length > 0) {
        toast.success("Bank account connected! Your transactions have been imported.");
      } else {
        // Refresh may show newly linked accounts
        toast.success("Bank account connected successfully.");
      }
    } catch (err: any) {
      const mapped = mapError(err);
      if (mapped === NETWORK_MESSAGES.OFFLINE) {
        setNetworkOffline();
        Alert.alert("No Internet Connection", "Please check your connection and try again.");
      } else {
        Alert.alert(mapped.title ?? "Connection Failed", mapped.message);
      }
    } finally {
      setConnecting(false);
    }
  }, [token, connecting, refreshAccounts, accounts]);

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Accounts</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable onPress={handleSync} disabled={syncing} style={styles.addBtnSmall}>
            {syncing
              ? <ActivityIndicator size="small" color={C.tint} />
              : <Ionicons name="sync-outline" size={20} color={C.tint} />}
          </Pressable>
          <Pressable onPress={() => setShowModal(true)} style={styles.addBtnSmall}>
            <Ionicons name="add" size={22} color={C.tint} />
          </Pressable>
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
        <View style={styles.summaryRow}>
          <View style={styles.summaryStat}>
            <Text style={styles.summaryLabel}>Total Assets</Text>
            <Text style={[styles.summaryValue, { color: C.positive }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{formatCAD(totalAssets)}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryStat}>
            <Text style={styles.summaryLabel}>Liabilities</Text>
            <Text style={[styles.summaryValue, { color: C.negative }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{formatCAD(totalLiabilities)}</Text>
          </View>
        </View>

        {byType.banking.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Banking</Text>
            <View style={styles.card}>
              {byType.banking.map((a, i) => (
                <View key={a.id}>
                  <AccountRow account={a} onEdit={() => setEditingAccount(a)} onRemove={() => removeAccount(a.id)} />
                  {i < byType.banking.length - 1 && <View style={styles.rowDivider} />}
                </View>
              ))}
            </View>
          </View>
        )}

        {byType.registered.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Registered Accounts</Text>
              <View style={styles.caBadge}>
                <Ionicons name="leaf" size={11} color={C.tint} />
                <Text style={styles.caBadgeText}>Tax-Advantaged</Text>
              </View>
            </View>
            <View style={styles.card}>
              {byType.registered.map((a, i) => (
                <View key={a.id}>
                  <AccountRow account={a} onEdit={() => setEditingAccount(a)} onRemove={() => removeAccount(a.id)} />
                  {i < byType.registered.length - 1 && <View style={styles.rowDivider} />}
                </View>
              ))}
            </View>
          </View>
        )}

        {byType.investments.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Investments</Text>
            <View style={styles.card}>
              {byType.investments.map((a, i) => (
                <View key={a.id}>
                  <AccountRow account={a} onEdit={() => setEditingAccount(a)} onRemove={() => removeAccount(a.id)} />
                  {i < byType.investments.length - 1 && <View style={styles.rowDivider} />}
                </View>
              ))}
            </View>
          </View>
        )}

        {byType.credit.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Credit</Text>
            <View style={styles.card}>
              {byType.credit.map((a, i) => (
                <View key={a.id}>
                  <AccountRow account={a} onEdit={() => setEditingAccount(a)} onRemove={() => removeAccount(a.id)} />
                  {i < byType.credit.length - 1 && <View style={styles.rowDivider} />}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Plaid Connect Button */}
        <Pressable
          onPress={isPro ? handleConnectPlaid : openPaywall}
          disabled={connecting}
          style={[styles.plaidConnectBtn, connecting && { opacity: 0.6 }]}
        >
          {!isPro && <Ionicons name="lock-closed" size={16} color="#000" />}
          {connecting
            ? <ActivityIndicator color="#000" />
            : <Ionicons name="link-outline" size={20} color="#000" />}
          <Text style={styles.plaidConnectText}>
            {connecting ? "Connecting…" : "Connect Bank with Plaid"}
          </Text>
        </Pressable>

        <View style={styles.tipCard}>
          <Ionicons name="information-circle-outline" size={18} color={C.tint} />
          <Text style={styles.tipText}>
            Tap any account to edit it. Long-press to remove. Use + to add a manual account, or connect your bank with Plaid above.
          </Text>
        </View>
      </ScrollView>

      <AccountModal visible={showModal} onClose={() => setShowModal(false)} />
      {editingAccount && (
        <AccountModal
          visible
          initial={editingAccount}
          onClose={() => setEditingAccount(null)}
        />
      )}
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
  addBtnSmall: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: `${C.tint}18`,
    alignItems: "center", justifyContent: "center",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 120,
    gap: 20,
  },
  summaryRow: {
    flexDirection: "row",
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
  },
  summaryStat: { flex: 1, alignItems: "center", gap: 4 },
  summaryLabel: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted },
  summaryValue: { fontFamily: "DM_Sans_700Bold", fontSize: 20, letterSpacing: -0.5 },
  summaryDivider: { width: 1, backgroundColor: C.border },
  section: { gap: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontFamily: "DM_Sans_600SemiBold", fontSize: 17, color: C.text, flexShrink: 1 },
  caBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: `${C.tint}18`,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  caBadgeText: { fontFamily: "DM_Sans_500Medium", fontSize: 11, color: C.tint },
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  accountIcon: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  accountInfo: { flex: 1, gap: 4 },
  accountName: { fontFamily: "DM_Sans_600SemiBold", fontSize: 15, color: C.text },
  accountMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  accountInstitution: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted },
  typeBadge: { borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  typeText: { fontFamily: "DM_Sans_700Bold", fontSize: 9, letterSpacing: 0.5 },
  plaidBadge: { borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, backgroundColor: "#1A3AFF22" },
  plaidBadgeText: { fontFamily: "DM_Sans_700Bold", fontSize: 9, letterSpacing: 0.5, color: "#4F7EFF" },
  balance: { fontFamily: "DM_Sans_700Bold", fontSize: 16, color: C.text },
  rowDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 16 },
  plaidConnectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: C.tint,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  plaidConnectText: { fontFamily: "DM_Sans_600SemiBold", fontSize: 16, color: "#000", textAlign: "center" },
  tipCard: {
    flexDirection: "row", gap: 10,
    backgroundColor: `${C.tint}10`,
    borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: `${C.tint}20`,
  },
  tipText: { fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textSecondary, flex: 1, lineHeight: 18 },
  modal: { flex: 1, backgroundColor: C.background, paddingHorizontal: 20, paddingTop: 16 },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: C.borderStrong,
    alignSelf: "center", marginBottom: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: { fontFamily: "DM_Sans_700Bold", fontSize: 22, color: C.text },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.elevated,
    alignItems: "center", justifyContent: "center",
  },
  fieldGroup: { gap: 8 },
  fieldLabel: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.textSecondary, letterSpacing: 0.3 },
  input: {
    backgroundColor: C.elevated,
    borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    fontFamily: "DM_Sans_400Regular", fontSize: 16,
    color: C.text,
    borderWidth: 1, borderColor: C.border,
  },
  hint: { fontFamily: "DM_Sans_400Regular", fontSize: 12, color: C.textMuted },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: C.elevated,
    borderWidth: 1, borderColor: C.border,
  },
  typeChipActive: { borderColor: C.tint, backgroundColor: `${C.tint}15` },
  typeChipText: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.textSecondary },
  instChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: C.elevated,
    borderWidth: 1, borderColor: C.border,
  },
  instChipActive: { borderColor: C.tint, backgroundColor: `${C.tint}15` },
  instChipText: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.textSecondary },
  colorRow: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  colorSwatch: { width: 36, height: 36, borderRadius: 18 },
  colorSwatchSelected: { borderWidth: 2.5, borderColor: C.text },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.tint,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 4,
  },
  addBtnText: { fontFamily: "DM_Sans_700Bold", fontSize: 16, color: "#000" },
});
