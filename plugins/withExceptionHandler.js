/**
 * withExceptionHandler.js
 *
 * Expo config plugin that injects NSSetUncaughtExceptionHandler into AppDelegate
 * at prebuild time. Handles both Swift (Expo SDK 51+) and ObjC++ (.mm) AppDelegates.
 *
 * Swift: uses trailing-closure syntax — no & function pointer, no ObjC function.
 * ObjC: uses a static C function + &functionPointer syntax.
 *
 * Usage in app.json:
 *   "plugins": ["./plugins/withExceptionHandler"]
 */

const { withAppDelegate } = require("@expo/config-plugins");

// ── Swift injection ──────────────────────────────────────────────────────────
// Valid Swift — closure syntax, no semicolons, no & prefix.
const SWIFT_INJECTION = `    NSSetUncaughtExceptionHandler { exception in
      NSLog("[ThriveUncaughtException] name=%@ reason=%@ stack=%@",
            exception.name.rawValue,
            exception.reason ?? "nil",
            exception.callStackSymbols.joined(separator: "\\n"))
    }
`;

// ── ObjC++ injection (kept for .mm fallback) ─────────────────────────────────
const OBJC_HANDLER_FN = `
static void ThriveUncaughtExceptionHandler(NSException *exception) {
  NSLog(@"[ThriveUncaughtException] name=%@ reason=%@ stack=%@",
        exception.name, exception.reason,
        [exception.callStackSymbols componentsJoinedByString:@"\\n"]);
}

`;
const OBJC_REGISTRATION = `  NSSetUncaughtExceptionHandler(&ThriveUncaughtExceptionHandler);\n`;

// Idempotency marker — present in both Swift and ObjC injections.
const MARKER = "ThriveUncaughtException";

module.exports = function withExceptionHandler(config) {
  return withAppDelegate(config, (config) => {
    const { modResults } = config;
    let contents = modResults.contents;

    // Already patched — nothing to do.
    if (contents.includes(MARKER)) {
      return config;
    }

    if (modResults.language === "swift") {
      // ── Swift AppDelegate ─────────────────────────────────────────────────
      // Find didFinishLaunchingWithOptions, then locate its opening brace.
      // The Swift signature spans multiple lines; the `{` appears at the end
      // of the `-> Bool {` line. We search for the first `{` + newline after
      // the didFinishLaunchingWithOptions token — safe because the parameter
      // type [UIApplication.LaunchOptionsKey: Any] uses [] not {}.
      const marker = "didFinishLaunchingWithOptions";
      const markerIdx = contents.indexOf(marker);

      if (markerIdx === -1) {
        console.warn("[withExceptionHandler] didFinishLaunchingWithOptions not found in AppDelegate.swift — skipping");
        return config;
      }

      const openBraceIdx = contents.indexOf("{\n", markerIdx);
      if (openBraceIdx === -1) {
        console.warn("[withExceptionHandler] Could not find opening { after didFinishLaunchingWithOptions — skipping");
        return config;
      }

      // Insert right after the `{\n` that opens the method body.
      contents =
        contents.slice(0, openBraceIdx + 2) +
        SWIFT_INJECTION +
        contents.slice(openBraceIdx + 2);

    } else {
      // ── ObjC / ObjC++ AppDelegate (.m / .mm) ─────────────────────────────
      if (contents.includes("@implementation AppDelegate")) {
        contents = contents.replace(
          "@implementation AppDelegate",
          `${OBJC_HANDLER_FN}@implementation AppDelegate`
        );
      }

      // Insert after the opening { of didFinishLaunchingWithOptions.
      // ObjC signature is single-line: ...didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
      contents = contents.replace(
        /(didFinishLaunchingWithOptions:[^{]*\{[ \t]*(?:\r?\n))/,
        `$1${OBJC_REGISTRATION}`
      );
    }

    modResults.contents = contents;
    return config;
  });
};
