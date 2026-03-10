import React, { useState, useEffect, useCallback } from "react";
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
  Switch,
  Linking,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useFinance } from "@/context/FinanceContext";
import { getFunctionsUrl } from "@/lib/functions";

const C = Colors.dark;

const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";

const NOTIF_KEYS = {
  budgetAlerts: "thrive_notif_budget_alerts",
  monthlySummary: "thrive_notif_monthly_summary",
  billReminders: "thrive_notif_bill_reminders",
};

const BIOMETRIC_KEY = "thrive_biometric_enabled";

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

function SettingsRow({
  icon,
  iconColor = C.tint,
  label,
  value,
  onPress,
  destructive = false,
  rightElement,
  chevron = true,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  label: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  rightElement?: React.ReactNode;
  chevron?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      style={({ pressed }) => [styles.row, pressed && onPress && { opacity: 0.6 }]}
    >
      <View style={[styles.rowIconWrap, { backgroundColor: `${iconColor}22` }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <Text style={[styles.rowLabel, destructive && { color: C.negative }]}>{label}</Text>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        {rightElement ?? null}
        {chevron && onPress && !rightElement ? (
          <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
        ) : null}
      </View>
    </Pressable>
  );
}

function RowDivider() {
  return <View style={styles.rowDivider} />;
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

// ── Delete Account Modal ──────────────────────────────────────────────────────

function DeleteAccountModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { deleteAccount } = useAuth();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reset = () => { setPassword(""); setError(""); };
  const handleClose = () => { reset(); onClose(); };

  const handleDelete = async () => {
    setError("");
    if (!password) { setError("Please enter your password to confirm."); return; }
    Alert.alert(
      "Are you absolutely sure?",
      "All your financial data will be erased forever.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, Delete Everything",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              await deleteAccount(password);
            } catch (e: any) {
              setLoading(false);
              setError(e.message || "Failed to delete account.");
            }
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Pressable onPress={handleClose} style={styles.modalCancelBtn}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>Delete Account</Text>
          <Pressable onPress={handleDelete} disabled={loading} style={styles.modalSaveBtn}>
            {loading
              ? <ActivityIndicator color={C.negative} size="small" />
              : <Text style={[styles.modalSaveText, { color: C.negative }]}>Delete</Text>}
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <Text style={[styles.fieldLabel, { fontSize: 14, lineHeight: 20 }]}>
            This will permanently delete your account and all associated data. Enter your password to confirm.
          </Text>
          {error ? <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View> : null}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Password</Text>
            <TextInput
              style={styles.fieldInput}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Enter your password"
              placeholderTextColor={C.textMuted}
              autoCapitalize="none"
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Change Password Modal ─────────────────────────────────────────────────────

function ChangePasswordModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reset = () => { setCurrent(""); setNext(""); setConfirm(""); setError(""); };

  const handleClose = () => { reset(); onClose(); };

  const handleSave = async () => {
    setError("");
    if (!current || !next || !confirm) { setError("All fields are required."); return; }
    if (next.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (next !== confirm) { setError("Passwords don't match."); return; }
    setLoading(true);
    try {
      await changePassword(current, next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Password Changed", "Your password has been updated.");
      handleClose();
    } catch (e: any) {
      setError(e.message || "Failed to change password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Pressable onPress={handleClose} style={styles.modalCancelBtn}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>Change Password</Text>
          <Pressable onPress={handleSave} disabled={loading} style={styles.modalSaveBtn}>
            {loading
              ? <ActivityIndicator color={C.tint} size="small" />
              : <Text style={styles.modalSaveText}>Save</Text>}
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          {error ? <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View> : null}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Current Password</Text>
            <TextInput
              style={styles.fieldInput}
              value={current}
              onChangeText={setCurrent}
              secureTextEntry
              placeholder="Enter current password"
              placeholderTextColor={C.textMuted}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>New Password</Text>
            <TextInput
              style={styles.fieldInput}
              value={next}
              onChangeText={setNext}
              secureTextEntry
              placeholder="At least 8 characters"
              placeholderTextColor={C.textMuted}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Confirm New Password</Text>
            <TextInput
              style={styles.fieldInput}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              placeholder="Repeat new password"
              placeholderTextColor={C.textMuted}
              autoCapitalize="none"
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, token, logout } = useAuth();
  const { accounts, removeAccount } = useFinance();

  const topPad = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;

  // Modals
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);

  // Biometrics
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricType, setBiometricType] = useState<"Face ID" | "Touch ID" | "Biometrics">("Biometrics");
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  // Notifications
  const [budgetAlerts, setBudgetAlerts] = useState(false);
  const [monthlySummary, setMonthlySummary] = useState(false);
  const [billReminders, setBillReminders] = useState(false);

  // Subscription
  const [plan] = useState<"Free" | "Pro">("Free");

  // Plaid
  const [connecting, setConnecting] = useState(false);
  const plaidAccounts = accounts.filter((a) => a.id.startsWith("plaid_"));

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      // Biometrics
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      setBiometricSupported(hasHardware && isEnrolled);

      if (hasHardware) {
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
        if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
          setBiometricType("Face ID");
        } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
          setBiometricType("Touch ID");
        }
      }

      const savedBiometric = await AsyncStorage.getItem(BIOMETRIC_KEY);
      setBiometricEnabled(savedBiometric === "true");

      // Notifications
      const [ba, ms, br] = await Promise.all([
        AsyncStorage.getItem(NOTIF_KEYS.budgetAlerts),
        AsyncStorage.getItem(NOTIF_KEYS.monthlySummary),
        AsyncStorage.getItem(NOTIF_KEYS.billReminders),
      ]);
      setBudgetAlerts(ba === "true");
      setMonthlySummary(ms === "true");
      setBillReminders(br === "true");
    })();
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleBiometricToggle = useCallback(async (value: boolean) => {
    if (value) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: `Enable ${biometricType} for Thrive`,
        cancelLabel: "Cancel",
      });
      if (!result.success) return;
    }
    setBiometricEnabled(value);
    await AsyncStorage.setItem(BIOMETRIC_KEY, String(value));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [biometricType]);

  const handleNotifToggle = useCallback(async (key: keyof typeof NOTIF_KEYS, value: boolean) => {
    if (value) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Notifications Disabled",
          "Enable notifications in Settings to receive alerts.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }
    }
    const setters: Record<keyof typeof NOTIF_KEYS, (v: boolean) => void> = {
      budgetAlerts: setBudgetAlerts,
      monthlySummary: setMonthlySummary,
      billReminders: setBillReminders,
    };
    setters[key](value);
    await AsyncStorage.setItem(NOTIF_KEYS[key], String(value));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleSignOut = useCallback(() => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: logout },
    ]);
  }, [logout]);

  const handleDeleteAccount = useCallback(() => {
    setShowDeleteAccount(true);
  }, []);

  const handleDisconnectPlaid = useCallback((id: string, name: string) => {
    Alert.alert(
      `Disconnect ${name}?`,
      "This will remove this account and its transactions from Thrive.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await removeAccount(id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch {
              Alert.alert("Error", "Failed to disconnect account.");
            }
          },
        },
      ]
    );
  }, [removeAccount]);

  const handleConnectPlaid = useCallback(async () => {
    setConnecting(true);
    try {
      const base = getFunctionsUrl();
      const resp = await fetch(`${base}/plaidLinkToken`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await resp.json();
      if (!resp.ok) {
        Alert.alert("Error", data.error || "Could not start Plaid connection.");
        return;
      }
      await WebBrowser.openBrowserAsync(`${base}/plaidLink?session=${encodeURIComponent(data.session_token)}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Connected!", "Your bank account has been linked.");
    } catch (err: any) {
      Alert.alert("Connection Failed", err.message || "Unable to connect to Plaid.");
    } finally {
      setConnecting(false);
    }
  }, [token]);

  const handleUpgradePro = useCallback(() => {
    // RevenueCat paywall — requires native build with react-native-purchases
    Alert.alert(
      "Upgrade to Pro",
      "Pro features including unlimited AI insights, advanced budgeting, and priority support.\n\nFull in-app purchase requires a production build.",
      [{ text: "Got It" }]
    );
  }, []);

  const handleRestorePurchases = useCallback(() => {
    Alert.alert("Restore Purchases", "No purchases found to restore.", [{ text: "OK" }]);
  }, []);

  // ── Initials avatar ───────────────────────────────────────────────────────

  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : "TH";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, Platform.OS === "web" && { paddingBottom: 34 }]}
      >
        {/* ── Account ── */}
        <SectionHeader title="Account" />
        <Card>
          {/* Profile */}
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileEmail}>{user?.email ?? "—"}</Text>
              <View style={styles.planBadge}>
                <Ionicons name="leaf" size={11} color={C.tint} />
                <Text style={styles.planBadgeText}>{plan} Plan</Text>
              </View>
            </View>
          </View>
          <RowDivider />
          <SettingsRow
            icon="lock-closed-outline"
            label="Change Password"
            onPress={() => setShowChangePassword(true)}
          />
          <RowDivider />
          <SettingsRow
            icon="log-out-outline"
            iconColor={C.gold}
            label="Sign Out"
            onPress={handleSignOut}
          />
          <RowDivider />
          <SettingsRow
            icon="trash-outline"
            iconColor={C.negative}
            label="Delete Account"
            destructive
            onPress={handleDeleteAccount}
          />
        </Card>

        {/* ── Subscription ── */}
        <SectionHeader title="Subscription" />
        <Card>
          <SettingsRow
            icon="star-outline"
            iconColor={C.gold}
            label="Current Plan"
            value={plan}
            chevron={false}
          />
          {plan === "Free" && (
            <>
              <RowDivider />
              <SettingsRow
                icon="rocket-outline"
                iconColor={C.gold}
                label="Upgrade to Pro"
                onPress={handleUpgradePro}
              />
            </>
          )}
          <RowDivider />
          <SettingsRow
            icon="refresh-outline"
            label="Restore Purchases"
            onPress={handleRestorePurchases}
          />
        </Card>

        {/* ── Security ── */}
        <SectionHeader title="Security" />
        <Card>
          <SettingsRow
            icon={biometricType === "Face ID" ? "scan-outline" : "finger-print-outline"}
            label={biometricType}
            chevron={false}
            disabled={!biometricSupported}
            rightElement={
              <Switch
                value={biometricEnabled}
                onValueChange={handleBiometricToggle}
                disabled={!biometricSupported}
                trackColor={{ false: C.border, true: `${C.tint}88` }}
                thumbColor={biometricEnabled ? C.tint : C.textMuted}
              />
            }
          />
          {!biometricSupported && (
            <Text style={styles.disabledHint}>
              {biometricType} is not available on this device.
            </Text>
          )}
        </Card>

        {/* ── Connected Accounts ── */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeader}>Connected Accounts</Text>
          <Pressable
            onPress={handleConnectPlaid}
            disabled={connecting}
            style={styles.sectionAddBtn}
          >
            {connecting
              ? <ActivityIndicator size="small" color={C.tint} />
              : <Ionicons name="add" size={18} color={C.tint} />}
          </Pressable>
        </View>
        <Card>
          {plaidAccounts.length === 0 ? (
            <View style={styles.emptyRow}>
              <Ionicons name="link-outline" size={20} color={C.textMuted} />
              <Text style={styles.emptyText}>No connected bank accounts</Text>
            </View>
          ) : (
            plaidAccounts.map((acc, i) => (
              <View key={acc.id}>
                {i > 0 && <RowDivider />}
                <SettingsRow
                  icon="business-outline"
                  iconColor={acc.color}
                  label={acc.name}
                  value={acc.institution}
                  chevron={false}
                  rightElement={
                    <Pressable
                      onPress={() => handleDisconnectPlaid(acc.id, acc.name)}
                      hitSlop={10}
                      style={styles.disconnectBtn}
                    >
                      <Text style={styles.disconnectText}>Disconnect</Text>
                    </Pressable>
                  }
                />
              </View>
            ))
          )}
        </Card>

        {/* ── Notifications ── */}
        <SectionHeader title="Notifications" />
        <Card>
          <SettingsRow
            icon="alert-circle-outline"
            label="Budget Alerts"
            chevron={false}
            rightElement={
              <Switch
                value={budgetAlerts}
                onValueChange={(v) => handleNotifToggle("budgetAlerts", v)}
                trackColor={{ false: C.border, true: `${C.tint}88` }}
                thumbColor={budgetAlerts ? C.tint : C.textMuted}
              />
            }
          />
          <RowDivider />
          <SettingsRow
            icon="calendar-outline"
            label="Monthly Summary"
            chevron={false}
            rightElement={
              <Switch
                value={monthlySummary}
                onValueChange={(v) => handleNotifToggle("monthlySummary", v)}
                trackColor={{ false: C.border, true: `${C.tint}88` }}
                thumbColor={monthlySummary ? C.tint : C.textMuted}
              />
            }
          />
          <RowDivider />
          <SettingsRow
            icon="notifications-outline"
            label="Bill Reminders"
            chevron={false}
            rightElement={
              <Switch
                value={billReminders}
                onValueChange={(v) => handleNotifToggle("billReminders", v)}
                trackColor={{ false: C.border, true: `${C.tint}88` }}
                thumbColor={billReminders ? C.tint : C.textMuted}
              />
            }
          />
        </Card>

        {/* ── Support ── */}
        <SectionHeader title="Support" />
        <Card>
          <SettingsRow
            icon="mail-outline"
            label="Contact Support"
            onPress={() => Linking.openURL("mailto:support@thrive.finance?subject=Thrive%20Support")}
          />
          <RowDivider />
          <SettingsRow
            icon="star-half-outline"
            label="Rate Thrive"
            onPress={() =>
              Linking.openURL(
                Platform.OS === "ios"
                  ? "itms-apps://apps.apple.com/app/id000000000?action=write-review"
                  : "market://details?id=com.thrive.finance"
              )
            }
          />
          <RowDivider />
          <SettingsRow
            icon="shield-outline"
            label="Privacy Policy"
            onPress={() => Linking.openURL("https://thrive.finance/privacy")}
          />
          <RowDivider />
          <SettingsRow
            icon="document-text-outline"
            label="Terms of Service"
            onPress={() => Linking.openURL("https://thrive.finance/terms")}
          />
        </Card>

        {/* ── App ── */}
        <SectionHeader title="App" />
        <Card>
          <SettingsRow
            icon="leaf-outline"
            label="Version"
            value={APP_VERSION}
            chevron={false}
          />
        </Card>

        <View style={{ height: 40 }} />
      </ScrollView>

      <ChangePasswordModal visible={showChangePassword} onClose={() => setShowChangePassword(false)} />
      <DeleteAccountModal visible={showDeleteAccount} onClose={() => setShowDeleteAccount(false)} />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },

  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerTitle: { fontFamily: "DM_Sans_700Bold", fontSize: 28, color: C.text, letterSpacing: -0.5 },

  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 120,
    gap: 6,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
    marginBottom: 6,
    marginLeft: 4,
    marginRight: 0,
  },
  sectionAddBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: `${C.tint}18`,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHeader: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 13,
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  rowIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    flex: 1,
    fontFamily: "DM_Sans_500Medium",
    fontSize: 15,
    color: C.text,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowValue: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 14,
    color: C.textSecondary,
  },
  rowDivider: {
    height: 1,
    backgroundColor: C.border,
    marginLeft: 62,
  },

  // Profile
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: `${C.tint}22`,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: `${C.tint}55`,
  },
  avatarText: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 17,
    color: C.tint,
  },
  profileInfo: { flex: 1, gap: 5 },
  profileEmail: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 15,
    color: C.text,
  },
  planBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    backgroundColor: `${C.tint}18`,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  planBadgeText: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 11,
    color: C.tint,
  },

  // Connected accounts
  emptyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  emptyText: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 14,
    color: C.textMuted,
  },
  disconnectBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: `${C.negative}18`,
  },
  disconnectText: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 12,
    color: C.negative,
  },

  // Biometric hint
  disabledHint: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 12,
    color: C.textMuted,
    paddingHorizontal: 16,
    paddingBottom: 12,
    marginTop: -4,
  },

  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: C.background,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  modalTitle: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 17,
    color: C.text,
  },
  modalCancelBtn: { minWidth: 60 },
  modalCancelText: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 15,
    color: C.textSecondary,
  },
  modalSaveBtn: { minWidth: 60, alignItems: "flex-end" },
  modalSaveText: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 15,
    color: C.tint,
  },
  fieldGroup: { gap: 6 },
  fieldLabel: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 13,
    color: C.textSecondary,
    letterSpacing: 0.3,
  },
  fieldInput: {
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 15,
    color: C.text,
  },
  errorBanner: {
    backgroundColor: `${C.negative}18`,
    borderRadius: 10,
    padding: 12,
  },
  errorText: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 13,
    color: C.negative,
  },
});
