import React, { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  Platform,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withTiming,
  FadeInDown,
} from "react-native-reanimated";
import { fetch } from "expo/fetch";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { getFunctionsUrl } from "@/lib/functions";
import { useAuth } from "@/context/AuthContext";
import { useFinance } from "@/context/FinanceContext";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { usePro } from "@/hooks/usePro";
import toast from "@/utils/toast";
import { AI_MESSAGES, NETWORK_MESSAGES } from "@/utils/errorMessages";
import { setNetworkOffline, setNetworkOnline } from "@/hooks/useNetworkStatus";

const C = Colors.dark;

/** AI request timeout in milliseconds */
const AI_TIMEOUT_MS = 30_000;

interface BudgetItem { category: string; limit: number; }

interface MessageAction {
  type: "set_budgets";
  budgets: BudgetItem[];
  summary: string;
  applied: boolean;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  action?: MessageAction;
  isError?: boolean;
}

let msgCounter = 0;
function genId(): string {
  msgCounter++;
  return `msg-${Date.now()}-${msgCounter}-${Math.random().toString(36).substr(2, 7)}`;
}

const QUICK_PROMPTS = [
  "How much did I spend this month?",
  "What are my biggest spending categories?",
  "Create a budget based on my transactions",
  "Am I spending too much on dining out?",
  "Should I contribute to RRSP or TFSA?",
  "How can I improve my savings rate?",
];

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Groceries: "basket-outline",
  Dining: "restaurant-outline",
  Transport: "car-outline",
  Shopping: "bag-outline",
  Entertainment: "game-controller-outline",
  Utilities: "flash-outline",
  Housing: "home-outline",
  Health: "heart-outline",
  "Personal Care": "person-outline",
  Subscriptions: "repeat-outline",
  Savings: "save-outline",
  Income: "trending-up-outline",
  Travel: "airplane-outline",
  Other: "ellipsis-horizontal-outline",
};

function BudgetActionCard({ action }: { action: MessageAction }) {
  return (
    <View style={styles.actionCard}>
      <View style={styles.actionCardHeader}>
        <View style={styles.actionCardBadge}>
          <Ionicons name="checkmark-circle" size={15} color={C.tint} />
          <Text style={styles.actionCardBadgeText}>Budget Applied</Text>
        </View>
      </View>
      {action.summary ? (
        <Text style={styles.actionCardSummary}>{action.summary}</Text>
      ) : null}
      <View style={styles.actionCardDivider} />
      {action.budgets.map((b) => {
        const icon = CATEGORY_ICONS[b.category] ?? "ellipsis-horizontal-outline";
        return (
          <View key={b.category} style={styles.actionBudgetRow}>
            <View style={styles.actionBudgetIcon}>
              <Ionicons name={icon} size={14} color={C.tint} />
            </View>
            <Text style={styles.actionBudgetCategory}>{b.category}</Text>
            <Text style={styles.actionBudgetLimit}>${b.limit.toLocaleString()}/mo</Text>
          </View>
        );
      })}
    </View>
  );
}

function TypingDots() {
  const dot1 = useSharedValue(0);
  const dot2 = useSharedValue(0);
  const dot3 = useSharedValue(0);

  React.useEffect(() => {
    dot1.value = withRepeat(withTiming(1, { duration: 400 }), -1, true);
    setTimeout(() => { dot2.value = withRepeat(withTiming(1, { duration: 400 }), -1, true); }, 150);
    setTimeout(() => { dot3.value = withRepeat(withTiming(1, { duration: 400 }), -1, true); }, 300);
  }, []);

  const d1Style = useAnimatedStyle(() => ({ opacity: 0.3 + dot1.value * 0.7, transform: [{ translateY: -dot1.value * 4 }] }));
  const d2Style = useAnimatedStyle(() => ({ opacity: 0.3 + dot2.value * 0.7, transform: [{ translateY: -dot2.value * 4 }] }));
  const d3Style = useAnimatedStyle(() => ({ opacity: 0.3 + dot3.value * 0.7, transform: [{ translateY: -dot3.value * 4 }] }));

  return (
    <View style={styles.typingBubble}>
      <View style={styles.typingDots}>
        <Animated.View style={[styles.dot, d1Style]} />
        <Animated.View style={[styles.dot, d2Style]} />
        <Animated.View style={[styles.dot, d3Style]} />
      </View>
    </View>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  // Strip the financial context prefix from display
  const displayContent = message.content.replace(/^\[FINANCIAL DATA\][\s\S]*?\[\/FINANCIAL DATA\]\n\n/, "");

  return (
    <Animated.View
      entering={FadeInDown.duration(200).springify()}
      style={[styles.bubbleContainer, isUser && styles.bubbleContainerUser]}
    >
      {!isUser && (
        <View style={[styles.avatarContainer, message.isError && styles.avatarError]}>
          <Ionicons name={message.isError ? "alert-circle" : "leaf"} size={14} color={message.isError ? C.negative : C.tint} />
        </View>
      )}
      <View style={styles.bubbleColumn}>
        {displayContent.length > 0 && (
          <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant, message.isError && styles.bubbleErrorAssistant]}>
            <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser, message.isError && styles.bubbleTextError]}>
              {displayContent}
            </Text>
          </View>
        )}
        {message.action?.type === "set_budgets" && (
          <BudgetActionCard action={message.action} />
        )}
        {/* Hallucination disclaimer for assistant messages with dollar amounts */}
        {!isUser && !message.isError && displayContent.match(/\$[\d,]+/) && (
          <Text style={styles.disclaimer}>{AI_MESSAGES.HALLUCINATION_DISCLAIMER}</Text>
        )}
      </View>
    </Animated.View>
  );
}

function EmptyState({ onPrompt }: { onPrompt: (p: string) => void }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Ionicons name="sparkles" size={32} color={C.tint} />
      </View>
      <Text style={styles.emptyTitle}>Your Finance Assistant</Text>
      <Text style={styles.emptySubtitle}>
        Ask about your spending, or say "create a budget" and I'll build and apply one from your real transactions.
      </Text>
      <View style={styles.quickPromptsGrid}>
        {QUICK_PROMPTS.map((p) => (
          <Pressable key={p} onPress={() => onPrompt(p)} style={styles.quickPrompt}>
            <Text style={styles.quickPromptText}>{p}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const BUDGET_INTENT_KEYWORDS = [
  "create budget", "make budget", "build budget", "set budget", "set up budget",
  "create a budget", "make a budget", "build a budget", "set a budget",
  "update budget", "update my budget", "change my budget", "adjust budget",
  "new budget", "suggest a budget", "suggest budget", "recommend a budget",
  "fix my budget", "redo my budget", "revise my budget",
];

function hasBudgetIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return BUDGET_INTENT_KEYWORDS.some((kw) => lower.includes(kw));
}

function buildFinancialContext(
  accounts: ReturnType<typeof useFinance>["accounts"],
  transactions: ReturnType<typeof useFinance>["transactions"],
  budgets: ReturnType<typeof useFinance>["budgets"],
  monthlyIncome: number,
  monthlyExpenses: number,
  netWorth: number,
  totalAssets: number,
  totalLiabilities: number,
): string {
  const today = new Date();
  const lines: string[] = [];

  lines.push(`Today: ${today.toISOString().split("T")[0]}`);
  lines.push(`Net worth: $${netWorth.toFixed(2)} CAD (Assets: $${totalAssets.toFixed(2)}, Liabilities: $${totalLiabilities.toFixed(2)})`);
  lines.push(`This month — Income: $${monthlyIncome.toFixed(2)}, Expenses: $${monthlyExpenses.toFixed(2)}, Savings: $${(monthlyIncome - monthlyExpenses).toFixed(2)}`);

  if (accounts.length > 0) {
    lines.push("\nACCOUNTS:");
    for (const a of accounts) {
      lines.push(`  ${a.name} (${a.institution}, ${a.type}): $${a.balance.toFixed(2)}`);
    }
  }

  if (budgets.length > 0) {
    lines.push("\nCURRENT BUDGETS (this month):");
    for (const b of budgets) {
      lines.push(`  ${b.category}: spent $${b.spent.toFixed(2)} of $${b.limit.toFixed(2)} limit`);
    }
  }

  if (transactions.length > 0) {
    const sorted = [...transactions]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 100);
    lines.push("\nRECENT TRANSACTIONS (newest first):");
    for (const t of sorted) {
      const sign = t.amount >= 0 ? "+" : "";
      lines.push(`  ${t.date} | ${t.description}${t.merchant ? ` (${t.merchant})` : ""} | ${sign}$${t.amount.toFixed(2)} | ${t.category}`);
    }
  }

  return lines.join("\n");
}

function useTabBarHeight() {
  try {
    return useBottomTabBarHeight();
  } catch {
    return 83;
  }
}

export default function AssistantScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useTabBarHeight();
  const { token, user } = useAuth();
  const { isPro, openPaywall } = usePro();
  const { accounts, transactions, budgets, monthlyIncome, monthlyExpenses, netWorth, totalAssets, totalLiabilities, setBudgets } = useFinance();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const [freeUsageCount, setFreeUsageCount] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const abortRef = useRef<AbortController | null>(null);

  const topPad = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;

  const [keyboardVisible, setKeyboardVisible] = useState(false);
  React.useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const inputBottomPad = Platform.OS === "web"
    ? Math.max(insets.bottom, 34) + 8
    : keyboardVisible ? insets.bottom + 8 : tabBarHeight + 8;

  // Load free usage count for non-pro users
  React.useEffect(() => {
    if (!user || isPro) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", user.id, "aiUsage", "monthly"));
        if (snap.exists()) {
          const data = snap.data();
          const now = new Date();
          const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          setFreeUsageCount(data[key] ?? 0);
        }
      } catch { /* best-effort — don't block the UI */ }
    })();
  }, [user, isPro]);

  const addErrorMessage = useCallback((text: string) => {
    setMessages((prev) => [...prev, { id: genId(), role: "assistant", content: text, isError: true }]);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const trimmed = text.trim();
    const currentMessages = [...messages];
    const userMsg: Message = { id: genId(), role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);
    setShowTyping(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Free tier usage gating
    if (!isPro) {
      if (freeUsageCount >= 3) {
        setIsStreaming(false);
        setShowTyping(false);
        openPaywall();
        return;
      }
      const now = new Date();
      const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const newCount = freeUsageCount + 1;
      try {
        await setDoc(doc(db, "users", user!.id, "aiUsage", "monthly"), { [key]: newCount }, { merge: true });
        setFreeUsageCount(newCount);
      } catch { /* best-effort — don't block the message */ }
    }

    // Build financial context — failure is non-blocking
    let financialContext = "";
    try {
      financialContext = buildFinancialContext(
        accounts, transactions, budgets,
        monthlyIncome, monthlyExpenses, netWorth, totalAssets, totalLiabilities,
      );
    } catch {
      // Context injection failed — send message without financial data
    }

    const contextPrefix = financialContext.length > 0
      ? `[FINANCIAL DATA]\n${financialContext}\n[/FINANCIAL DATA]\n\n`
      : "";

    const chatHistory = [
      ...currentMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: contextPrefix + trimmed },
    ];

    // Set up timeout + abort controller
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort("timeout"), AI_TIMEOUT_MS);

    try {
      const response = await fetch(`${getFunctionsUrl()}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: chatHistory,
          ...(hasBudgetIntent(trimmed) ? { forceTool: "set_budgets" } : {}),
        }),
        signal: controller.signal,
      });

      setNetworkOnline();
      clearTimeout(timeoutId);

      // Handle HTTP error codes before streaming
      if (!response.ok) {
        if (response.status === 429) {
          addErrorMessage(AI_MESSAGES.RATE_LIMIT.message);
          return;
        }
        if (response.status === 500 || response.status === 503) {
          addErrorMessage(AI_MESSAGES.UNAVAILABLE.message);
          return;
        }
        // Try to parse a structured error
        const errBody = await response.json().catch(() => ({}));
        const errMsg = errBody?.error ?? "";
        if (errMsg.toLowerCase().includes("content") || errMsg.toLowerCase().includes("policy")) {
          addErrorMessage(AI_MESSAGES.CONTENT_POLICY.message);
        } else {
          addErrorMessage(AI_MESSAGES.UNAVAILABLE.message);
        }
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        addErrorMessage(AI_MESSAGES.STREAM_INTERRUPTED.message);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let assistantAdded = false;
      let assistantMsgId = genId();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.content) {
              fullContent += parsed.content;
              setShowTyping(false);
              if (!assistantAdded) {
                setMessages((prev) => [...prev, { id: assistantMsgId, role: "assistant", content: fullContent }]);
                assistantAdded = true;
              } else {
                setMessages((prev) => prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: fullContent } : m
                ));
              }
            }

            if (parsed.action === "set_budgets" && Array.isArray(parsed.budgets)) {
              const newBudgets = parsed.budgets.map((b: BudgetItem) => ({
                category: b.category,
                limit: b.limit,
                spent: 0,
              }));
              try {
                await setBudgets(newBudgets);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch {
                toast.warning("Couldn't save the suggested budget. Please try again.");
              }

              const action: MessageAction = {
                type: "set_budgets",
                budgets: parsed.budgets,
                summary: parsed.summary || "",
                applied: true,
              };

              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.id === assistantMsgId) {
                  return prev.map((m) => m.id === assistantMsgId ? { ...m, action } : m);
                }
                return [...prev, { id: assistantMsgId, role: "assistant", content: "", action }];
              });
            }
          } catch { /* malformed SSE chunk — skip */ }
        }
      }

      // Empty response guard
      if (fullContent.trim().length === 0 && !assistantAdded) {
        addErrorMessage(AI_MESSAGES.EMPTY_RESPONSE.message);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      setShowTyping(false);

      const isAbort = err?.name === "AbortError" || err === "timeout";
      const msg: string = (err?.message ?? "").toLowerCase();

      if (isAbort) {
        addErrorMessage(AI_MESSAGES.TIMEOUT.message);
      } else if (
        msg.includes("network request failed") ||
        msg.includes("failed to fetch") ||
        msg.includes("network error")
      ) {
        setNetworkOffline();
        addErrorMessage(NETWORK_MESSAGES.OFFLINE.message);
      } else if (msg.includes("content") || msg.includes("policy")) {
        addErrorMessage(AI_MESSAGES.CONTENT_POLICY.message);
      } else {
        addErrorMessage("Sorry, I had trouble connecting. Please try again.");
      }
    } finally {
      setIsStreaming(false);
      setShowTyping(false);
      abortRef.current = null;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [messages, isStreaming, accounts, transactions, budgets, monthlyIncome, monthlyExpenses, netWorth, totalAssets, totalLiabilities, token, setBudgets, isPro, freeUsageCount, openPaywall, user, addErrorMessage]);

  const handleSend = useCallback(() => {
    sendMessage(input);
    inputRef.current?.focus();
  }, [input, sendMessage]);

  const reversedMessages = [...messages].reverse();
  const sendScale = useSharedValue(1);
  const sendStyle = useAnimatedStyle(() => ({ transform: [{ scale: sendScale.value }] }));

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>AI Assistant</Text>
          <Text style={styles.headerSubtitle}>Agentic Finance Coach</Text>
        </View>
        <View style={styles.statusDot}>
          <View style={styles.onlineDot} />
          <Text style={styles.onlineText}>Online</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.chatContainer}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <FlatList
          data={reversedMessages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          inverted={messages.length > 0}
          ListHeaderComponent={showTyping ? <TypingDots /> : null}
          ListFooterComponent={messages.length === 0 ? (
            <EmptyState onPrompt={(p) => sendMessage(p)} />
          ) : null}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />

        <View style={[styles.inputContainer, { paddingBottom: inputBottomPad }]}>
          {!isPro && freeUsageCount >= 2 && (
            <View style={styles.freeWarning}>
              <Text style={styles.freeWarningText}>
                {freeUsageCount >= 3 ? "Free limit reached" : `${3 - freeUsageCount} free message${3 - freeUsageCount !== 1 ? "s" : ""} left`}
              </Text>
              <Pressable onPress={openPaywall}>
                <Text style={styles.freeWarningUpgrade}>Upgrade →</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Ask about spending, create a budget…"
              placeholderTextColor={C.textMuted}
              multiline
              maxLength={500}
              returnKeyType="default"
              editable={!isStreaming}
            />
            <Animated.View style={sendStyle}>
              <Pressable
                onPress={handleSend}
                onPressIn={() => { sendScale.value = withSpring(0.9); }}
                onPressOut={() => { sendScale.value = withSpring(1); }}
                disabled={isStreaming || !input.trim()}
                style={[styles.sendBtn, (!input.trim() || isStreaming) && styles.sendBtnDisabled]}
              >
                {isStreaming ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Ionicons name="arrow-up" size={20} color={input.trim() ? "#000" : C.textMuted} />
                )}
              </Pressable>
            </Animated.View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingBottom: 12,
  },
  headerTitle: { fontFamily: "DM_Sans_700Bold", fontSize: 28, color: C.text, letterSpacing: -0.5 },
  headerSubtitle: { fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textMuted },
  statusDot: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: `${C.positive}18`, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    flexShrink: 0,
  },
  onlineDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.positive },
  onlineText: { fontFamily: "DM_Sans_500Medium", fontSize: 12, color: C.positive },
  chatContainer: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, flexGrow: 1 },
  bubbleContainer: { flexDirection: "row", marginBottom: 12, alignItems: "flex-end", gap: 8 },
  bubbleContainerUser: { justifyContent: "flex-end" },
  bubbleColumn: { flex: 1, gap: 4 },
  avatarContainer: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: `${C.tint}20`, alignItems: "center", justifyContent: "center", marginBottom: 2,
    flexShrink: 0,
  },
  avatarError: { backgroundColor: `${C.negative}20` },
  bubble: { maxWidth: "100%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: C.tint, borderBottomRightRadius: 4, alignSelf: "flex-end", maxWidth: "78%" },
  bubbleAssistant: { backgroundColor: C.elevated, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: C.border },
  bubbleErrorAssistant: { backgroundColor: `${C.negative}12`, borderColor: `${C.negative}30` },
  bubbleText: { fontFamily: "DM_Sans_400Regular", fontSize: 15, color: C.text, lineHeight: 22 },
  bubbleTextUser: { color: "#000", fontFamily: "DM_Sans_500Medium" },
  bubbleTextError: { color: C.negative },
  disclaimer: {
    fontFamily: "DM_Sans_400Regular", fontSize: 11, color: C.textMuted,
    lineHeight: 15, paddingHorizontal: 4, marginTop: 2,
  },
  // Action card
  actionCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: `${C.tint}40`,
    overflow: "hidden",
  },
  actionCardHeader: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  actionCardBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: `${C.tint}18`, alignSelf: "flex-start",
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  actionCardBadgeText: { fontFamily: "DM_Sans_600SemiBold", fontSize: 12, color: C.tint },
  actionCardSummary: {
    fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textSecondary,
    paddingHorizontal: 14, paddingBottom: 10, lineHeight: 18,
  },
  actionCardDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 14 },
  actionBudgetRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  actionBudgetIcon: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: `${C.tint}15`, alignItems: "center", justifyContent: "center",
  },
  actionBudgetCategory: { fontFamily: "DM_Sans_500Medium", fontSize: 14, color: C.text, flex: 1 },
  actionBudgetLimit: { fontFamily: "DM_Sans_700Bold", fontSize: 14, color: C.tint },
  // Typing
  typingBubble: { flexDirection: "row", alignItems: "flex-end", marginBottom: 12 },
  typingDots: {
    flexDirection: "row", gap: 4, backgroundColor: C.elevated,
    borderRadius: 18, borderBottomLeftRadius: 4,
    paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1, borderColor: C.border,
  },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.tint },
  // Empty state
  emptyState: { flex: 1, alignItems: "center", paddingTop: 40, paddingHorizontal: 20, gap: 12 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: `${C.tint}18`, alignItems: "center", justifyContent: "center",
    marginBottom: 4, borderWidth: 1, borderColor: `${C.tint}30`,
  },
  emptyTitle: { fontFamily: "DM_Sans_700Bold", fontSize: 22, color: C.text, textAlign: "center", alignSelf: "stretch" },
  emptySubtitle: { fontFamily: "DM_Sans_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center", lineHeight: 22, marginBottom: 8, alignSelf: "stretch" },
  quickPromptsGrid: { width: "100%", gap: 8 },
  quickPrompt: { backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: C.border },
  quickPromptText: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.textSecondary },
  // Free tier warning
  freeWarning: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: `${C.gold}18`, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8, marginBottom: 8,
    borderWidth: 1, borderColor: `${C.gold}30`,
  },
  freeWarningText: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.gold },
  freeWarningUpgrade: { fontFamily: "DM_Sans_600SemiBold", fontSize: 13, color: C.tint },
  // Input
  inputContainer: { backgroundColor: C.background, paddingHorizontal: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  inputRow: {
    flexDirection: "row", alignItems: "flex-end", gap: 10,
    backgroundColor: C.elevated, borderRadius: 20, borderWidth: 1, borderColor: C.borderStrong,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  input: { flex: 1, fontFamily: "DM_Sans_400Regular", fontSize: 15, color: C.text, maxHeight: 100, paddingVertical: 4 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.tint, alignItems: "center", justifyContent: "center" },
  sendBtnDisabled: { backgroundColor: C.elevated, borderWidth: 1, borderColor: C.border },
});
