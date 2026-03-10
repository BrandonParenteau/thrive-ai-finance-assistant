import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Google from "expo-auth-session/providers/google";
import * as AppleAuthentication from "expo-apple-authentication";
import { GoogleAuthProvider, OAuthProvider } from "firebase/auth";
import * as WebBrowser from "expo-web-browser";
import { useAuth } from "@/context/AuthContext";

WebBrowser.maybeCompleteAuthSession();

export function useSocialAuth() {
  const { loginWithCredential } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

  // Google.useAuthRequest throws a render error if the platform-specific client ID
  // is undefined. Pass a placeholder so the hook initialises safely; the button is
  // hidden/disabled via isGoogleAvailable when credentials are not configured.
  const isGoogleAvailable = !!(
    (Platform.OS === "ios" && iosClientId) ||
    (Platform.OS === "android" && androidClientId) ||
    (Platform.OS === "web" && webClientId)
  );

  const [request, response, promptGoogleAsync] = Google.useAuthRequest({
    iosClientId: iosClientId ?? "not-configured",
    androidClientId: androidClientId ?? "not-configured",
    webClientId: webClientId ?? "not-configured",
  });

  useEffect(() => {
    if (response?.type === "success") {
      const { id_token } = response.params;
      const credential = GoogleAuthProvider.credential(id_token);
      setLoading(true);
      loginWithCredential(credential)
        .catch((err: any) => setError(err.message || "Google sign-in failed"))
        .finally(() => setLoading(false));
    } else if (response?.type === "error") {
      setError(response.error?.message || "Google sign-in failed");
    }
  }, [response]);

  const signInWithGoogle = async () => {
    setError("");
    await promptGoogleAsync();
  };

  const signInWithApple = async () => {
    if (Platform.OS !== "ios") return;
    setError("");
    setLoading(true);
    try {
      const appleCredential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      const provider = new OAuthProvider("apple.com");
      const credential = provider.credential({
        idToken: appleCredential.identityToken!,
      });
      await loginWithCredential(credential);
    } catch (err: any) {
      if (err.code !== "ERR_REQUEST_CANCELED") {
        setError(err.message || "Apple sign-in failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const isAppleAvailable = Platform.OS === "ios";

  return {
    signInWithGoogle,
    signInWithApple,
    isAppleAvailable,
    isGoogleAvailable,
    googleRequest: request,
    loading,
    error,
    clearError: () => setError(""),
  };
}
