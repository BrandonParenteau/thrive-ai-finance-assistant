const palette = {
  green900: "#042212",
  green800: "#0A3A1E",
  green700: "#0D4A27",
  green600: "#165C33",
  green500: "#1E7A42",
  green400: "#27A058",
  green300: "#32C86E",
  green200: "#6EDDA0",
  green100: "#B2F0CE",

  mint: "#00D4A0",
  mintDim: "#00A880",

  gold: "#F5C842",
  goldDim: "#C49B1F",

  red: "#FF5252",
  redDim: "#CC3333",

  bg: "#080F0C",
  bgCard: "#0F1C15",
  bgCardAlt: "#132018",
  bgElevated: "#192A1F",

  textPrimary: "#F0F7F2",
  textSecondary: "#8DB89A",
  textMuted: "#4A6E55",

  border: "#1C3028",
  borderStrong: "#2D4E3A",
};

export default {
  dark: {
    text: palette.textPrimary,
    textSecondary: palette.textSecondary,
    textMuted: palette.textMuted,
    background: palette.bg,
    card: palette.bgCard,
    cardAlt: palette.bgCardAlt,
    elevated: palette.bgElevated,
    tint: palette.mint,
    tintDim: palette.mintDim,
    gold: palette.gold,
    goldDim: palette.goldDim,
    positive: palette.green300,
    negative: palette.red,
    border: palette.border,
    borderStrong: palette.borderStrong,
    tabIconDefault: palette.textMuted,
    tabIconSelected: palette.mint,
  },
  palette,
};
