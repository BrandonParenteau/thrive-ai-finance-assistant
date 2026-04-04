import { ScrollView, ScrollViewProps } from "react-native";

// react-native-keyboard-controller removed due to New Architecture TurboModule
// crash (NativeEventEmitter at module-eval time). Using plain RN ScrollView.
export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = "handled",
  ...props
}: ScrollViewProps) {
  return (
    <ScrollView keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...props}>
      {children}
    </ScrollView>
  );
}
