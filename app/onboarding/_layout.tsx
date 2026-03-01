import { Stack } from "expo-router";
import Colors from "@/constants/colors";

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.dark.background },
      }}
    >
      <Stack.Screen name="income" />
      <Stack.Screen name="categories" />
      <Stack.Screen name="connect" />
    </Stack>
  );
}
