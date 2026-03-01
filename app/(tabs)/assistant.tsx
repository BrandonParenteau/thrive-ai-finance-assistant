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
import { getApiUrl } from "@/lib/query-client";

const C = Colors.dark;

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

let msgCounter = 0;
function genId(): string {
  msgCounter++;
  return `msg-${Date.now()}-${msgCounter}-${Math.random().toString(36).substr(2, 7)}`;
}

const QUICK_PROMPTS = [
  "How much TFSA room do I have?",
  "Should I contribute to RRSP or TFSA?",
  "Explain FHSA for first-time buyers",
  "Best Canadian ETFs for beginners",
  "How does CPP work?",
  "What's a good savings rate?",
];

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
  return (
    <Animated.View
      entering={FadeInDown.duration(200).springify()}
      style={[styles.bubbleContainer, isUser && styles.bubbleContainerUser]}
    >
      {!isUser && (
        <View style={styles.avatarContainer}>
          <Ionicons name="leaf" size={14} color={C.tint} />
        </View>
      )}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>
          {message.content}
        </Text>
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
      <Text style={styles.emptyTitle}>Your Finance Coach</Text>
      <Text style={styles.emptySubtitle}>
        Ask anything about Canadian personal finance — TFSAs, RRSPs, taxes, investing, and more.
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const topPad = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;
  const inputBottomPad = Platform.OS === "web"
    ? Math.max(insets.bottom, 34) + 8
    : tabBarHeight + 8;

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

    try {
      const chatHistory = [
        ...currentMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: trimmed },
      ];
      const baseUrl = getApiUrl();
      const response = await fetch(`${baseUrl}api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ messages: chatHistory }),
      });
      if (!response.ok) throw new Error("Request failed");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let assistantAdded = false;

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
              if (!assistantAdded) {
                setShowTyping(false);
                setMessages((prev) => [...prev, { id: genId(), role: "assistant", content: fullContent }]);
                assistantAdded = true;
              } else {
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...updated[updated.length - 1], content: fullContent };
                  return updated;
                });
              }
            }
          } catch {}
        }
      }
    } catch {
      setShowTyping(false);
      setMessages((prev) => [...prev, { id: genId(), role: "assistant", content: "Sorry, I had trouble connecting. Please try again." }]);
    } finally {
      setIsStreaming(false);
      setShowTyping(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [messages, isStreaming]);

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
        <View>
          <Text style={styles.headerTitle}>AI Assistant</Text>
          <Text style={styles.headerSubtitle}>Canadian Finance Coach</Text>
        </View>
        <View style={styles.statusDot}>
          <View style={styles.onlineDot} />
          <Text style={styles.onlineText}>Online</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.chatContainer}
        behavior="padding"
        keyboardVerticalOffset={tabBarHeight}
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
          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Ask about TFSA, RRSP, taxes..."
              placeholderTextColor={C.textMuted}
              multiline
              maxLength={500}
              returnKeyType="default"
              blurOnSubmit={false}
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
  },
  onlineDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.positive },
  onlineText: { fontFamily: "DM_Sans_500Medium", fontSize: 12, color: C.positive },
  chatContainer: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, flexGrow: 1 },
  bubbleContainer: { flexDirection: "row", marginBottom: 12, alignItems: "flex-end", gap: 8 },
  bubbleContainerUser: { justifyContent: "flex-end" },
  avatarContainer: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: `${C.tint}20`, alignItems: "center", justifyContent: "center", marginBottom: 2,
  },
  bubble: { maxWidth: "78%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: C.tint, borderBottomRightRadius: 4 },
  bubbleAssistant: { backgroundColor: C.elevated, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: C.border },
  bubbleText: { fontFamily: "DM_Sans_400Regular", fontSize: 15, color: C.text, lineHeight: 22 },
  bubbleTextUser: { color: "#000", fontFamily: "DM_Sans_500Medium" },
  typingBubble: { flexDirection: "row", alignItems: "flex-end", marginBottom: 12 },
  typingDots: {
    flexDirection: "row", gap: 4, backgroundColor: C.elevated,
    borderRadius: 18, borderBottomLeftRadius: 4,
    paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1, borderColor: C.border,
  },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.tint },
  emptyState: { flex: 1, alignItems: "center", paddingTop: 40, paddingHorizontal: 16, gap: 12 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: `${C.tint}18`, alignItems: "center", justifyContent: "center",
    marginBottom: 4, borderWidth: 1, borderColor: `${C.tint}30`,
  },
  emptyTitle: { fontFamily: "DM_Sans_700Bold", fontSize: 22, color: C.text, textAlign: "center" },
  emptySubtitle: { fontFamily: "DM_Sans_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center", lineHeight: 22, marginBottom: 8 },
  quickPromptsGrid: { width: "100%", gap: 8 },
  quickPrompt: { backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: C.border },
  quickPromptText: { fontFamily: "DM_Sans_500Medium", fontSize: 13, color: C.textSecondary },
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
