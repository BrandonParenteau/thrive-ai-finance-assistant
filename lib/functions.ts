/**
 * Returns the base URL for Firebase Cloud Functions.
 * Set EXPO_PUBLIC_FUNCTIONS_URL in your .env file:
 *   Production: https://us-central1-fortifyai.cloudfunctions.net
 *   Emulator:   http://localhost:5001/fortifyai/us-central1
 */
export function getFunctionsUrl(): string {
  const url = process.env.EXPO_PUBLIC_FUNCTIONS_URL;
  if (!url) throw new Error("EXPO_PUBLIC_FUNCTIONS_URL is not set");
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
