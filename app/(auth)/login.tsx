import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { useSocialAuth } from "@/hooks/useSocialAuth";
import Colors from "@/constants/colors";

const C = Colors.dark;

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const { signInWithGoogle, signInWithApple, isAppleAvailable, googleRequest, loading: socialLoading, error: socialError, clearError: clearSocialError } = useSocialAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const topPad = Platform.OS === "web" ? Math.max(insets.top, 67) : insets.top;
  const bottomPad = Platform.OS === "web" ? Math.max(insets.bottom, 34) : insets.bottom;

  const handleLogin = async () => {
    setError("");
    if (!email.trim()) { setError("Please enter your email"); return; }
    if (!password) { setError("Please enter your password"); return; }
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 20, paddingBottom: bottomPad + 24 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.logoRow}>
        <View style={styles.logoIcon}>
          <Ionicons name="leaf" size={28} color={C.tint} />
        </View>
        <Text style={styles.logoText}>Thrive</Text>
      </View>

      <Text style={styles.title}>Welcome back</Text>
      <Text style={styles.subtitle}>Sign in to your account</Text>

      <View style={styles.form}>
        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="mail-outline" size={18} color={C.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={C.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color={C.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              placeholderTextColor={C.textMuted}
              secureTextEntry={!showPassword}
              autoComplete="password"
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
            <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
              <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={C.textMuted} />
            </Pressable>
          </View>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.primaryBtnText}>Sign In</Text>
          )}
        </Pressable>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {socialError ? <Text style={styles.errorText}>{socialError}</Text> : null}

        <Pressable
          style={[styles.socialBtn, (socialLoading || !googleRequest) && styles.primaryBtnDisabled]}
          onPress={signInWithGoogle}
          disabled={socialLoading || !googleRequest}
        >
          <Ionicons name="logo-google" size={20} color={C.text} />
          <Text style={styles.socialBtnText}>Continue with Google</Text>
        </Pressable>

        {isAppleAvailable && (
          <Pressable
            style={[styles.socialBtn, socialLoading && styles.primaryBtnDisabled]}
            onPress={signInWithApple}
            disabled={socialLoading}
          >
            <Ionicons name="logo-apple" size={22} color={C.text} />
            <Text style={styles.socialBtnText}>Continue with Apple</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Don&apos;t have an account? </Text>
        <Pressable onPress={() => router.push("/(auth)/register")}>
          <Text style={styles.footerLink}>Create one</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  content: { paddingHorizontal: 24 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 40 },
  logoIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: `${C.tint}20`, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: `${C.tint}30`,
  },
  logoText: { fontFamily: "DM_Sans_700Bold", fontSize: 24, color: C.text },
  title: { fontFamily: "DM_Sans_700Bold", fontSize: 30, color: C.text, marginBottom: 6 },
  subtitle: { fontFamily: "DM_Sans_400Regular", fontSize: 16, color: C.textSecondary, marginBottom: 36 },
  form: { gap: 16 },
  field: { gap: 8 },
  label: { fontFamily: "DM_Sans_500Medium", fontSize: 14, color: C.textSecondary },
  inputWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.card, borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1, fontFamily: "DM_Sans_400Regular", fontSize: 15,
    color: C.text, paddingVertical: 14,
  },
  eyeBtn: { padding: 4 },
  errorText: {
    fontFamily: "DM_Sans_400Regular", fontSize: 13, color: "#FF5252",
    backgroundColor: "#FF525218", padding: 12, borderRadius: 10,
  },
  primaryBtn: {
    backgroundColor: C.tint, borderRadius: 14,
    paddingVertical: 16, alignItems: "center", marginTop: 8,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { fontFamily: "DM_Sans_600SemiBold", fontSize: 16, color: "#000" },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 32 },
  footerText: { fontFamily: "DM_Sans_400Regular", fontSize: 14, color: C.textSecondary },
  footerLink: { fontFamily: "DM_Sans_600SemiBold", fontSize: 14, color: C.tint },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { fontFamily: "DM_Sans_400Regular", fontSize: 13, color: C.textMuted },
  socialBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: C.card, borderRadius: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: C.border,
  },
  socialBtnText: { fontFamily: "DM_Sans_500Medium", fontSize: 15, color: C.text },
});
