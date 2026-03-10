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

  const [request, response, promptGoogleAsync] = Google.useAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
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
    googleRequest: request,
    loading,
    error,
    clearError: () => setError(""),
  };
}
