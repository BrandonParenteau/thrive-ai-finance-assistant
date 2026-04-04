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
  Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { doc, updateDoc, getDoc } from "firebase/firestore";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useFinance } from "@/context/FinanceContext";
import { getFunctionsUrl } from "@/lib/functions";
import { db } from "@/lib/firebase";
import { usePro } from "@/hooks/usePro";
import PaywallModal from "@/components/PaywallModal";
import BudgetAlertsModal from "@/components/BudgetAlertsModal";
import BillRemindersModal from "@/components/BillRemindersModal";
import {
  PROVINCES,
  DEFAULT_TAX_PROFILE,
  type TaxProfile,
} from "@/utils/canadianTaxRates";

const C = Colors.dark;

const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";

// Replace with your real App Store numeric ID once the app is live in App Store Connect.
// Leave as empty string until then — the "Rate Thrive" row will be hidden.
const APP_STORE_ID = "6748838810";

const NOTIF_KEYS = {
  budgetAlerts: "thrive_notif_budget_alerts",
  monthlySummary: "thrive_notif_monthly_summary",
  billReminders: "thrive_notif_bill_reminders",
  rrspDeadline: "thrive_notif_rrsp_deadline",
  tfsaNewRoom: "thrive_notif_tfsa_new_room",
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
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled" onScrollBeginDrag={Keyboard.dismiss}>
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
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled" onScrollBeginDrag={Keyboard.dismiss}>
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

// ── Tax Profile Modal ─────────────────────────────────────────────────────────

function TaxProfileModal({
  visible,
  initial,
  onSave,
  onClose,
}: {
  visible: boolean;
  initial: TaxProfile;
  onSave: (profile: TaxProfile) => Promise<void>;
  onClose: () => void;
}) {
  const [province, setProvince] = useState(initial.province);
  const [birthYear, setBirthYear] = useState(initial.birthYear.toString());
  const [rrspRoom, setRrspRoom] = useState(initial.rrspAvailableRoom.toString());
  const [fhsaYear, setFhsaYear] = useState(initial.fhsaYearOpened?.toString() ?? "");
  const [showProvincePicker, setShowProvincePicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (visible) {
      setProvince(initial.province);
      setBirthYear(initial.birthYear.toString());
      setRrspRoom(initial.rrspAvailableRoom.toString());
      setFhsaYear(initial.fhsaYearOpened?.toString() ?? "");
      setError("");
    }
  }, [visible, initial]);

  const handleSave = async () => {
    const by = parseInt(birthYear);
    if (isNaN(by) || by < 1920 || by > 2010) { setError("Enter a valid birth year (1920–2010)"); return; }
    const rrsp = parseFloat(rrspRoom) || 0;
    const fhsa = fhsaYear ? parseInt(fhsaYear) : null;
    if (fhsa !== null && (isNaN(fhsa) || fhsa < 2023)) { setError("FHSA year must be 2023 or later"); return; }
    setLoading(true);
    try {
      await onSave({ province, birthYear: by, rrspAvailableRoom: rrsp, fhsaYearOpened: fhsa });
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to save");
    } finally {
      setLoading(false);
    }
  };

  const selectedProvinceName = PROVINCES.find((p) => p.code === province)?.name ?? province;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} style={styles.modalCancelBtn}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>Tax Profile</Text>
          <Pressable onPress={handleSave} disabled={loading} style={styles.modalSaveBtn}>
            {loading
              ? <ActivityIndicator color={C.tint} size="small" />
              : <Text style={styles.modalSaveText}>Save</Text>}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled" onScrollBeginDrag={Keyboard.dismiss}>
          <Text style={[styles.fieldLabel, { fontSize: 13, color: C.textMuted, lineHeight: 18 }]}>
            Your tax profile is used to calculate TFSA/RRSP contribution room and personalize AI tax optimization tips.
          </Text>

          {error ? <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View> : null}

          {/* Province */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Province / Territory</Text>
            <Pressable
              style={[styles.fieldInput, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}
              onPress={() => setShowProvincePicker((v) => !v)}
            >
              <Text style={{ fontFamily: "DM_Sans_400Regular", fontSize: 15, color: C.text }}>
                {selectedProvinceName}
              </Text>
              <Ionicons name={showProvincePicker ? "chevron-up" : "chevron-down"} size={16} color={C.textMuted} />
            </Pressable>
            {showProvincePicker && (
              <View style={taxProfileStyles.provincePicker}>
                {PROVINCES.map((p) => (
                  <Pressable
                    key={p.code}
                    style={[taxProfileStyles.provinceRow, province === p.code && taxProfileStyles.provinceRowSelected]}
                    onPress={() => { setProvince(p.code); setShowProvincePicker(false); }}
                  >
                    <Text style={[taxProfileStyles.provinceText, province === p.code && { color: C.tint, fontFamily: "DM_Sans_600SemiBold" }]}>
                      {p.name}
                    </Text>
                    {province === p.code && <Ionicons name="checkmark" size={16} color={C.tint} />}
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* Birth Year */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Birth Year</Text>
            <TextInput
              style={styles.fieldInput}
              value={birthYear}
              onChangeText={setBirthYear}
              keyboardType="number-pad"
              placeholder="e.g. 1990"
              placeholderTextColor={C.textMuted}
              maxLength={4}
            />
          </View>

          {/* RRSP Available Room */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>RRSP Available Room (optional — overrides auto-calculation)</Text>
            <View style={[styles.fieldInput, { flexDirection: "row", alignItems: "center", padding: 0, overflow: "hidden" }]}>
              <Text style={{ paddingHorizontal: 14, fontFamily: "DM_Sans_600SemiBold", fontSize: 16, color: C.textSecondary }}>$</Text>
              <TextInput
                style={{ flex: 1, fontFamily: "DM_Sans_400Regular", fontSize: 15, color: C.text, paddingVertical: 12, paddingRight: 14 }}
                value={rrspRoom}
                onChangeText={setRrspRoom}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={C.textMuted}
              />
            </View>
            <Text style={[styles.fieldLabel, { fontSize: 11, marginTop: 2 }]}>
              Unused room carries forward each year. Auto-calculation only estimates this year&apos;s new room. For your true total (including prior years), enter the figure from CRA My Account or your Notice of Assessment.
            </Text>
          </View>

          {/* FHSA Year Opened */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>FHSA Year Opened (leave blank if none)</Text>
            <TextInput
              style={styles.fieldInput}
              value={fhsaYear}
              onChangeText={setFhsaYear}
              keyboardType="number-pad"
              placeholder="e.g. 2023"
              placeholderTextColor={C.textMuted}
              maxLength={4}
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
  const [showBudgetAlerts, setShowBudgetAlerts] = useState(false);
  const [showBillReminders, setShowBillReminders] = useState(false);

  // Biometrics
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricType, setBiometricType] = useState<"Face ID" | "Touch ID" | "Biometrics">("Biometrics");
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  // Notifications
  const [budgetAlerts, setBudgetAlerts] = useState(false);
  const [monthlySummary, setMonthlySummary] = useState(false);
  const [billReminders, setBillReminders] = useState(false);
  const [rrspDeadline, setRrspDeadline] = useState(false);
  const [tfsaNewRoom, setTfsaNewRoom] = useState(false);

  // Tax Profile
  const [taxProfile, setTaxProfile] = useState<TaxProfile>(DEFAULT_TAX_PROFILE);
  const [showTaxProfile, setShowTaxProfile] = useState(false);

  // Subscription / RevenueCat
  const { isPro, openPaywall, restore } = usePro();
  const plan = isPro ? "Pro" : "Free";
  const [restoringPurchases, setRestoringPurchases] = useState(false);
  const [paywallVisible, setPaywallVisible] = useState(false);

  // Plaid
  const [connecting, setConnecting] = useState(false);
  const plaidAccounts = accounts.filter((a) => a.id.startsWith("plaid_"));

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      // Biometrics — wrapped in try/catch to prevent NSException → Hermes SIGSEGV
      try {
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
      } catch { /* biometric hardware unavailable — skip silently */ }

      const savedBiometric = await AsyncStorage.getItem(BIOMETRIC_KEY);
      setBiometricEnabled(savedBiometric === "true");

      // Tax profile
      if (user) {
        try {
          const snap = await getDoc(doc(db, "users", user.id));
          if (snap.exists() && snap.data().tax_profile) {
            setTaxProfile({ ...DEFAULT_TAX_PROFILE, ...snap.data().tax_profile });
          }
        } catch { /* non-critical */ }
      }

      // Notifications
      const [ba, ms, br, rd, tr] = await Promise.all([
        AsyncStorage.getItem(NOTIF_KEYS.budgetAlerts),
        AsyncStorage.getItem(NOTIF_KEYS.monthlySummary),
        AsyncStorage.getItem(NOTIF_KEYS.billReminders),
        AsyncStorage.getItem(NOTIF_KEYS.rrspDeadline),
        AsyncStorage.getItem(NOTIF_KEYS.tfsaNewRoom),
      ]);
      setBudgetAlerts(ba === "true");
      setMonthlySummary(ms === "true");
      setBillReminders(br === "true");
      setRrspDeadline(rd === "true");
      setTfsaNewRoom(tr === "true");
    })();
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleBiometricToggle = useCallback(async (value: boolean) => {
    if (value) {
      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: `Enable ${biometricType} for Thrive`,
          cancelLabel: "Cancel",
        });
        if (!result.success) return;
      } catch { return; }
    }
    setBiometricEnabled(value);
    await AsyncStorage.setItem(BIOMETRIC_KEY, String(value));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [biometricType]);

  const handleNotifToggle = useCallback(async (key: keyof typeof NOTIF_KEYS, value: boolean) => {
    if (value) {
      let status = "denied";
      try {
        ({ status } = await Notifications.requestPermissionsAsync());
      } catch { /* permissions API unavailable */ }
      if (status !== "granted") {
        Alert.alert(
          "Notifications Disabled",
          "Please enable notifications in your device Settings to receive Thrive alerts.",
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
      rrspDeadline: setRrspDeadline,
      tfsaNewRoom: setTfsaNewRoom,
    };
    setters[key](value);
    await AsyncStorage.setItem(NOTIF_KEYS[key], String(value));
    await scheduleNotification(key, value);

    // For monthly summary: persist flag + push token to Firestore so the Cloud Function knows
    if (key === "monthlySummary" && user) {
      try {
        const updates: Record<string, any> = { monthly_summary_enabled: value };
        if (value && Platform.OS !== "web") {
          try {
            const tokenData = await Notifications.getExpoPushTokenAsync({
              projectId: Constants.expoConfig?.extra?.eas?.projectId,
            });
            updates.expo_push_token = tokenData.data;
          } catch { /* non-critical */ }
        }
        await updateDoc(doc(db, "users", user.id), updates);
      } catch { /* non-critical */ }
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [user]);

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

  const handleSaveTaxProfile = useCallback(async (profile: TaxProfile) => {
    if (!user) return;
    await updateDoc(doc(db, "users", user.id), { tax_profile: profile });
    setTaxProfile(profile);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [user]);

  /**
   * Schedules (or cancels) the notification for the given toggle key.
   * All notifications fire at a fixed future time and repeat on their cadence.
   *
   * Budget Alerts   — every Monday at 6 pm (weekly spending check-in)
   * Monthly Summary — 1st of each month at 9 am
   * Bill Reminders  — 25th of each month at 10 am
   * RRSP Deadline   — Feb 14 each year at 9 am (2 weeks before March 1 deadline)
   * TFSA / FHSA     — Jan 2 each year at 9 am (new contribution room)
   */
  const scheduleNotification = useCallback(async (key: keyof typeof NOTIF_KEYS, enable: boolean) => {
    if (Platform.OS === "web") return; // Web push not supported via expo-notifications
    const notifId = `thrive_sched_${key}`;

    // Always cancel first so toggling off or re-enabling always starts fresh
    await Notifications.cancelScheduledNotificationAsync(notifId).catch(() => {});
    if (!enable) return;

    const now = new Date();

    try {
      if (key === "budgetAlerts") {
        // Weekly — every Monday at 6 pm
        await Notifications.scheduleNotificationAsync({
          identifier: notifId,
          content: {
            title: "Weekly Budget Check-In",
            body: "How's your spending tracking this week? Open Thrive to review your budget progress.",
            data: { screen: "/(tabs)/insights" },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday: 2, // 1 = Sunday … 7 = Saturday
            hour: 18,
            minute: 0,
          },
        });

      } else if (key === "monthlySummary") {
        // Monthly — 1st of each month at 9 am
        await Notifications.scheduleNotificationAsync({
          identifier: notifId,
          content: {
            title: "Your Monthly Financial Summary",
            body: "A new month has started — see how your income, expenses, and net worth changed last month.",
            data: { type: "monthly_summary" },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
            day: 1,
            hour: 9,
            minute: 0,
            repeats: true,
          },
        });

      } else if (key === "billReminders") {
        // Monthly — 25th of each month at 10 am
        await Notifications.scheduleNotificationAsync({
          identifier: notifId,
          content: {
            title: "Month-End Bills Coming Up",
            body: "Bills are approaching — review your Thrive budget to make sure you're covered before month-end.",
            data: { screen: "/(tabs)/insights" },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
            day: 25,
            hour: 10,
            minute: 0,
            repeats: true,
          },
        });

      } else if (key === "rrspDeadline") {
        // Yearly — Feb 14 at 9 am (2 weeks before the March 1 RRSP deadline)
        // If we're already past Feb 14 this year, schedule for next year
        const nextYear = (now.getMonth() > 1 || (now.getMonth() === 1 && now.getDate() >= 14))
          ? now.getFullYear() + 1
          : now.getFullYear();
        await Notifications.scheduleNotificationAsync({
          identifier: notifId,
          content: {
            title: "RRSP Deadline in 2 Weeks",
            body: "The RRSP contribution deadline is March 1. Contributions reduce your taxable income — open Thrive to check your available room.",
            data: { screen: "/(tabs)/settings" },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
            year: nextYear,
            month: 2,
            day: 14,
            hour: 9,
            minute: 0,
            repeats: true,
          },
        });

      } else if (key === "tfsaNewRoom") {
        // Yearly — Jan 2 at 9 am (new TFSA / FHSA contribution room opens)
        const nextYear = (now.getMonth() > 0 || now.getDate() >= 2)
          ? now.getFullYear() + 1
          : now.getFullYear();
        await Notifications.scheduleNotificationAsync({
          identifier: notifId,
          content: {
            title: "New TFSA & FHSA Room Available",
            body: "$7,000 of new TFSA contribution room is available today. Open Thrive to see your updated limits.",
            data: { screen: "/(tabs)/settings" },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
            year: nextYear,
            month: 1,
            day: 2,
            hour: 9,
            minute: 0,
            repeats: true,
          },
        });
      }
    } catch {
      // Scheduling failure is non-critical — toggle state is already saved
    }
  }, []);

  const [testingNotifs, setTestingNotifs] = useState(false);

  const handleTestNotifications = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("Not Supported", "Push notifications are not available on web.");
      return;
    }
    let status = "denied";
    try {
      ({ status } = await Notifications.requestPermissionsAsync());
    } catch { /* permissions API unavailable */ }
    if (status !== "granted") {
      Alert.alert(
        "Notifications Disabled",
        "Please enable notifications in your device Settings first.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }

    setTestingNotifs(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const tests: Array<{ title: string; body: string; delay: number }> = [
      {
        title: "Weekly Budget Check-In",
        body: "How's your spending tracking this week? Open Thrive to review your budget progress.",
        delay: 3,
      },
      {
        title: "Your Monthly Financial Summary",
        body: "A new month has started — see how your income, expenses, and net worth changed last month.",
        delay: 6,
      },
      {
        title: "Month-End Bills Coming Up",
        body: "Bills are approaching — review your Thrive budget to make sure you're covered before month-end.",
        delay: 9,
      },
      {
        title: "RRSP Deadline in 2 Weeks",
        body: "The RRSP contribution deadline is March 1. Open Thrive to check your available room.",
        delay: 12,
      },
      {
        title: "New TFSA & FHSA Room Available",
        body: "$7,000 of new TFSA contribution room is available today. Open Thrive to see your updated limits.",
        delay: 15,
      },
    ];

    try {
      // Cancel any leftover test notifications from a previous run
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      await Promise.all(
        scheduled
          .filter((n) => n.identifier.startsWith("thrive_test_"))
          .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
      );

      // Schedule each one with a TIME_INTERVAL trigger so they fire in sequence
      for (const t of tests) {
        await Notifications.scheduleNotificationAsync({
          identifier: `thrive_test_${t.delay}`,
          content: { title: t.title, body: t.body, data: { screen: "/(tabs)" } },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: t.delay,
            repeats: false,
          },
        });
      }

      Alert.alert(
        "Test Notifications Sent",
        "5 notifications will arrive over the next 15 seconds — one every 3 seconds.\n\nBackground the app now to see them as banners.",
      );
    } catch {
      Alert.alert("Error", "Couldn't schedule test notifications. Please try again.");
    } finally {
      setTestingNotifs(false);
    }
  }, []);

  const handleUpgradePro = useCallback(() => {
    setPaywallVisible(true);
  }, []);

  const handleRestorePurchases = useCallback(async () => {
    setRestoringPurchases(true);
    try {
      const active = await restore();
      if (active) {
        Alert.alert("Restored!", "Your Pro subscription has been restored.");
      } else {
        Alert.alert("No purchases found", "No active subscription found to restore.");
      }
    } catch {
      Alert.alert("Restore failed", "Please try again.");
    } finally {
      setRestoringPurchases(false);
    }
  }, [restore]);

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
            value={isPro ? "Pro ✓" : "Free"}
            chevron={false}
          />
          {!isPro && (
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
            label={restoringPurchases ? "Restoring…" : "Restore Purchases"}
            onPress={handleRestorePurchases}
            disabled={restoringPurchases}
          />
        </Card>
        <PaywallModal
          visible={paywallVisible}
          onClose={() => setPaywallVisible(false)}
          onSubscribed={() => setPaywallVisible(false)}
        />

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
            onPress={isPro ? handleConnectPlaid : openPaywall}
            disabled={connecting}
            style={styles.sectionAddBtn}
          >
            {connecting
              ? <ActivityIndicator size="small" color={C.tint} />
              : !isPro
              ? <Ionicons name="lock-closed" size={16} color={C.tint} />
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

        {/* ── Tax Profile ── */}
        <SectionHeader title="Canadian Tax Profile" />
        <Card>
          <SettingsRow
            icon="document-text-outline"
            iconColor={C.gold}
            label="Tax Profile"
            value={taxProfile.province}
            onPress={() => setShowTaxProfile(true)}
          />
          <RowDivider />
          <SettingsRow
            icon="calendar-number-outline"
            iconColor="#56CFE1"
            label="RRSP Contribution Room"
            value={`$${Math.round(taxProfile.rrspAvailableRoom).toLocaleString("en-CA")}`}
            chevron={false}
          />
          <RowDivider />
          <SettingsRow
            icon="home-outline"
            iconColor={C.tint}
            label="FHSA"
            value={taxProfile.fhsaYearOpened ? `Since ${taxProfile.fhsaYearOpened}` : "Not opened"}
            chevron={false}
          />
        </Card>

        {/* ── Notifications ── */}
        <SectionHeader title="Notifications" />
        <Card>
          <SettingsRow
            icon="alert-circle-outline"
            label="Budget Alerts"
            value={budgetAlerts ? "On" : undefined}
            onPress={() => setShowBudgetAlerts(true)}
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
            value={billReminders ? "On" : undefined}
            onPress={() => setShowBillReminders(true)}
          />
          <RowDivider />
          <SettingsRow
            icon="trending-down-outline"
            iconColor="#56CFE1"
            label="RRSP Deadline Reminder"
            value="Mar 2"
            chevron={false}
            rightElement={
              <Switch
                value={rrspDeadline}
                onValueChange={(v) => handleNotifToggle("rrspDeadline", v)}
                trackColor={{ false: C.border, true: `${"#56CFE1"}88` }}
                thumbColor={rrspDeadline ? "#56CFE1" : C.textMuted}
              />
            }
          />
          <RowDivider />
          <SettingsRow
            icon="leaf-outline"
            iconColor={C.tint}
            label="TFSA / FHSA New Room"
            value="Jan 2"
            chevron={false}
            rightElement={
              <Switch
                value={tfsaNewRoom}
                onValueChange={(v) => handleNotifToggle("tfsaNewRoom", v)}
                trackColor={{ false: C.border, true: `${C.tint}88` }}
                thumbColor={tfsaNewRoom ? C.tint : C.textMuted}
              />
            }
          />
        </Card>

        {__DEV__ && (
          <Pressable
            onPress={handleTestNotifications}
            disabled={testingNotifs}
            style={({ pressed }) => [styles.testNotifBtn, (pressed || testingNotifs) && { opacity: 0.6 }]}
          >
            {testingNotifs
              ? <ActivityIndicator size="small" color={C.tint} />
              : <Ionicons name="flask-outline" size={16} color={C.tint} />}
            <Text style={styles.testNotifText}>
              {testingNotifs ? "Scheduling…" : "Test All Notifications"}
            </Text>
          </Pressable>
        )}

        {/* ── Support ── */}
        <SectionHeader title="Support" />
        <Card>
          <SettingsRow
            icon="mail-outline"
            label="Contact Support"
            onPress={() => Linking.openURL("mailto:customerservice@thethriveapp.net?subject=Thrive%20Support")}
          />
          {APP_STORE_ID ? (
            <>
              <RowDivider />
              <SettingsRow
                icon="star-half-outline"
                label="Rate Thrive"
                onPress={() =>
                  Linking.openURL(
                    Platform.OS === "ios"
                      ? `itms-apps://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`
                      : "market://details?id=com.thrive.finance"
                  )
                }
              />
            </>
          ) : null}
          <RowDivider />
          <SettingsRow
            icon="shield-outline"
            label="Privacy Policy"
            onPress={() => Linking.openURL("https://thethriveapp.net/privacy-policy.html")}
          />
          <RowDivider />
          <SettingsRow
            icon="document-text-outline"
            label="Terms of Service"
            onPress={() => Linking.openURL("https://thethriveapp.net/terms.html")}
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
      <TaxProfileModal
        visible={showTaxProfile}
        initial={taxProfile}
        onSave={handleSaveTaxProfile}
        onClose={() => setShowTaxProfile(false)}
      />
      <BudgetAlertsModal visible={showBudgetAlerts} onClose={() => {
        setShowBudgetAlerts(false);
        // Mark budget alerts as enabled if user has created any alerts
        setBudgetAlerts(true);
        AsyncStorage.setItem(NOTIF_KEYS.budgetAlerts, "true");
      }} />
      <BillRemindersModal visible={showBillReminders} onClose={() => {
        setShowBillReminders(false);
        // Mark bill reminders as enabled since user manages them
        setBillReminders(true);
        AsyncStorage.setItem(NOTIF_KEYS.billReminders, "true");
      }} />
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

  // Test notifications button
  testNotifBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: `${C.tint}30`,
    borderStyle: "dashed",
  },
  testNotifText: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 14,
    color: C.tint,
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

const taxProfileStyles = StyleSheet.create({
  provincePicker: {
    backgroundColor: C.elevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    marginTop: 4,
    overflow: "hidden",
    maxHeight: 280,
  },
  provinceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  provinceRowSelected: {
    backgroundColor: `${C.tint}10`,
  },
  provinceText: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 15,
    color: C.text,
  },
});
