/**
 * withPodfileModularHeaders.js
 *
 * Expo config plugin that:
 * 1. Injects `use_modular_headers!` into the Podfile so Firebase pods
 *    (FirebaseCoreInternal → GoogleUtilities) resolve Swift modules correctly.
 * 2. Writes `ios.buildReactNativeFromSource: "true"` to Podfile.properties.json
 *    so the Podfile opts out of the prebuilt React.framework, allowing
 *    patch-package changes to RCTTurboModule.mm to actually compile.
 * 3. Injects an ENV.delete block into the Podfile itself as a belt-and-suspenders
 *    guard — EAS may set RCT_USE_PREBUILT_RNCORE=1 in the process environment
 *    before pod install, which the Podfile's ||= cannot override. This block
 *    forcibly removes it when buildReactNativeFromSource is true.
 *
 * Survives `expo prebuild --clean` because it runs as a config plugin.
 */

const { withDangerousMod, withPodfileProperties } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MODULAR_HEADERS_MARKER = "# [withPodfileModularHeaders] use_modular_headers";
const FORCE_SOURCE_MARKER = "# [withPodfileModularHeaders] force-source-build";

// Inserted right before `prepare_react_native_project!` so it runs after the
// Podfile's own ||= assignments but before pods are configured.
const FORCE_SOURCE_BLOCK = `
${FORCE_SOURCE_MARKER}
if podfile_properties['ios.buildReactNativeFromSource'] == 'true'
  ENV.delete('RCT_USE_PREBUILT_RNCORE')
  ENV.delete('RCT_USE_RN_DEP')
end

`;

const MODULAR_HEADERS_LINE = `\n${MODULAR_HEADERS_MARKER}\nuse_modular_headers!\n`;

function withModularHeadersPodfile(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );
      let contents = fs.readFileSync(podfilePath, "utf-8");

      // 1. Inject force-source-build block before prepare_react_native_project!
      if (!contents.includes(FORCE_SOURCE_MARKER)) {
        contents = contents.replace(
          "prepare_react_native_project!",
          `${FORCE_SOURCE_BLOCK}prepare_react_native_project!`
        );
      }

      // 2. Add use_modular_headers! at end of file
      if (!contents.includes(MODULAR_HEADERS_MARKER)) {
        contents = contents.trimEnd() + MODULAR_HEADERS_LINE;
      }

      fs.writeFileSync(podfilePath, contents, "utf-8");
      return config;
    },
  ]);
}

function withBuildFromSourceProperty(config) {
  return withPodfileProperties(config, (config) => {
    config.modResults["ios.buildReactNativeFromSource"] = "true";
    return config;
  });
}

module.exports = function withPodfileModularHeaders(config) {
  config = withBuildFromSourceProperty(config);
  config = withModularHeadersPodfile(config);
  return config;
};
