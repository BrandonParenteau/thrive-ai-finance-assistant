import React, { useState, useCallback } from "react";
import { fetch } from "expo/fetch";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path, Line, Defs, LinearGradient as SvgGradient, Stop, Text as SvgText } from "react-native-svg";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
} from "firebase/firestore";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { getFunctionsUrl } from "@/lib/functions";
import {
  ScenarioParams,
  ScenarioType,
  SimulationResult,
  SavedScenario,
  getPresets,
  runSimulation,
  SCENARIO_ICONS,
} from "@/utils/scenarioSimulator";

const C = Colors.dark;

const CHART_H = 160;
const CHART_PAD_LEFT = 46;
const CHART_PAD_RIGHT = 12;
const CHART_PAD_TOP = 12;
const CHART_PAD_BOTTOM = 28;

function ScenarioChart({
  result,
  width,
}: {
  result: SimulationResult;
  width: number;
}) {
  const innerW = width - CHART_PAD_LEFT - CHART_PAD_RIGHT;
  const innerH = CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const { points } = result;

  if (points.length < 2) return null;

  const allValues = points.flatMap((p) => [p.baseline, p.scenario]);
  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const range = maxV - minV || 1;

  const toX = (i: number) => CHART_PAD_LEFT + (i / (points.length - 1)) * innerW;
  const toY = (v: number) => CHART_PAD_TOP + innerH - ((v - minV) / range) * innerH;

  const baselinePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.baseline).toFixed(1)}`)
    .join(" ");

  const scenarioPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.scenario).toFixed(1)}`)
    .join(" ");

  // Y-axis labels
  const yTicks = [minV, minV + range * 0.5, maxV];
  const formatV = (v: number) => {
    const abs = Math.abs(v);
    const s = v < 0 ? "-" : "";
    if (abs >= 1_000_000) return `${s}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1000) return `${s}$${Math.round(abs / 1000)}k`;
    return `${s}$${Math.round(abs)}`;
  };

  // X-axis: show first, middle, last month labels
  const xLabelIdxs = [0, Math.floor(points.length / 2), points.length - 1];
  const shortMo = (d: Date) => d.toLocaleDateString("en-CA", { month: "short", year: "2-digit" });

  return (
    <Svg width={width} height={CHART_H}>
      <Defs>
        <SvgGradient id="baselineGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={C.tint} stopOpacity="0.2" />
          <Stop offset="1" stopColor={C.tint} stopOpacity="0" />
        </SvgGradient>
        <SvgGradient id="scenarioGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={C.gold} stopOpacity="0.18" />
          <Stop offset="1" stopColor={C.gold} stopOpacity="0" />
        </SvgGradient>
      </Defs>

      {/* Grid lines */}
      {yTicks.map((v, i) => (
        <Line
          key={i}
          x1={CHART_PAD_LEFT}
          y1={toY(v)}
          x2={width - CHART_PAD_RIGHT}
          y2={toY(v)}
          stroke={C.border}
          strokeWidth={1}
        />
      ))}

      {/* Baseline path */}
      <Path d={baselinePath} stroke={C.tint} strokeWidth={2} fill="none" />

      {/* Scenario path */}
      <Path d={scenarioPath} stroke={C.gold} strokeWidth={2} fill="none" strokeDasharray="5,3" />

      {/* Y-axis labels */}
      {yTicks.map((v, i) => (
        <SvgText
          key={i}
          x={CHART_PAD_LEFT - 4}
          y={toY(v) + 4}
          textAnchor="end"
          fontSize={9}
          fill={C.textMuted}
        >
          {formatV(v)}
        </SvgText>
      ))}

      {/* X-axis labels */}
      {xLabelIdxs.map((idx) => (
        <SvgText
          key={idx}
          x={toX(idx)}
          y={CHART_H - 4}
          textAnchor="middle"
          fontSize={9}
          fill={C.textMuted}
        >
          {shortMo(points[idx].date)}
        </SvgText>
      ))}
    </Svg>
  );
}

function StatChip({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <View style={chipStyles.chip}>
      <Text style={chipStyles.label}>{label}</Text>
      <Text style={[chipStyles.value, positive === true && chipStyles.pos, positive === false && chipStyles.neg]}>
        {value}
      </Text>
    </View>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    flex: 1,
    backgroundColor: C.elevated,
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
    marginHorizontal: 3,
  },
  label: { fontSize: 10, color: C.textMuted, marginBottom: 3 },
  value: { fontSize: 13, fontWeight: "700", color: C.text },
  pos: { color: C.tint },
  neg: { color: "#FF6B6B" },
});

interface Props {
  visible: boolean;
  onClose: () => void;
  currentNetWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  chartWidth: number;
  isPremium?: boolean;
}

export default function ScenarioModal({
  visible,
  onClose,
  currentNetWorth,
  monthlyIncome,
  monthlyExpenses,
  chartWidth,
  isPremium = false,
}: Props) {
  const { user, token } = useAuth();
  const presets = getPresets(monthlyIncome, monthlyExpenses);

  const [activeTab, setActiveTab] = useState<"simulate" | "saved">("simulate");
  const [selectedPreset, setSelectedPreset] = useState<ScenarioType>("job_loss");
  const [params, setParams] = useState<ScenarioParams>(presets[0]);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);

  const monthlySavings = monthlyIncome - monthlyExpenses;
  const result: SimulationResult = runSimulation(currentNetWorth, monthlySavings, params);

  const formatCAD = (v: number, dec = 0) => {
    const abs = Math.abs(v);
    const s = v < 0 ? "-$" : "$";
    return `${s}${abs.toLocaleString("en-CA", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
  };

  const selectPreset = (type: ScenarioType) => {
    const preset = presets.find((p) => p.type === type) ?? presets[0];
    setSelectedPreset(type);
    setParams(preset);
    setAiSummary(null);
  };

  const updateParam = (key: keyof ScenarioParams, raw: string) => {
    const num = parseFloat(raw.replace(/[^0-9.\-]/g, "")) || 0;
    setParams((prev) => ({ ...prev, [key]: num }));
    setAiSummary(null);
  };

  const fetchAiSummary = async () => {
    if (!user || !token) return;
    setAiLoading(true);
    try {
      const resp = await fetch(`${getFunctionsUrl()}/scenarioSummary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          scenarioLabel: params.label,
          monthlyIncomeChange: params.monthlyIncomeChange,
          monthlyExpenseChange: params.monthlyExpenseChange,
          oneTimeCost: params.oneTimeCost,
          durationMonths: params.durationMonths,
          currentNetWorth,
          monthlyIncome,
          monthlyExpenses,
          netImpact: result.netImpact,
          breakEvenMonths: result.breakEvenMonths,
          lowestPoint: result.lowestPoint,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        console.error("scenarioSummary HTTP error:", resp.status, text);
        throw new Error(`HTTP ${resp.status}: ${text}`);
      }
      const data = await resp.json();
      setAiSummary(data.summary ?? "Unable to generate summary.");
    } catch (err: any) {
      console.error("scenarioSummary error:", err?.message ?? err);
      setAiSummary("Unable to generate summary at this time.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    const scenariosSnap = await getDocs(collection(db, "users", user.id, "scenarios"));
    if (!isPremium && scenariosSnap.size >= 2) {
      Alert.alert(
        "Upgrade to Thrive Pro",
        "Free accounts can save up to 2 scenarios. Upgrade to Pro for unlimited scenarios.",
        [{ text: "OK" }]
      );
      return;
    }
    setSaveLoading(true);
    try {
      await addDoc(collection(db, "users", user.id, "scenarios"), {
        label: params.label,
        type: params.type,
        params,
        netImpact: result.netImpact,
        createdAt: new Date().toISOString(),
      });
      Alert.alert("Saved", `"${params.label}" scenario saved.`);
    } catch {
      Alert.alert("Error", "Failed to save scenario.");
    } finally {
      setSaveLoading(false);
    }
  };

  const loadSaved = useCallback(async () => {
    if (!user) return;
    setSavedLoading(true);
    try {
      const snap = await getDocs(collection(db, "users", user.id, "scenarios"));
      setSavedScenarios(
        snap.docs.map((d) => ({
          id: d.id,
          label: d.data().label,
          type: d.data().type,
          params: d.data().params,
          netImpact: d.data().netImpact,
          createdAt: d.data().createdAt,
        }))
      );
    } catch {
      // non-critical
    } finally {
      setSavedLoading(false);
    }
  }, [user]);

  const handleDeleteSaved = (scenario: SavedScenario) => {
    if (!user) return;
    Alert.alert("Delete Scenario", `Delete "${scenario.label}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          await deleteDoc(doc(db, "users", user.id, "scenarios", scenario.id));
          setSavedScenarios((prev) => prev.filter((s) => s.id !== scenario.id));
        },
      },
    ]);
  };

  const loadSavedScenario = (scenario: SavedScenario) => {
    setParams(scenario.params);
    setSelectedPreset(scenario.type);
    setAiSummary(null);
    setActiveTab("simulate");
  };

  const handleTabChange = (tab: "simulate" | "saved") => {
    setActiveTab(tab);
    if (tab === "saved") loadSaved();
  };

  const netImpactPositive = result.netImpact >= 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          {/* Header */}
          <View style={s.header}>
            <Text style={s.title}>What If?</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={C.textSecondary} />
            </Pressable>
          </View>

          {/* Tabs */}
          <View style={s.tabRow}>
            <Pressable
              style={[s.tab, activeTab === "simulate" && s.tabActive]}
              onPress={() => handleTabChange("simulate")}
            >
              <Text style={[s.tabText, activeTab === "simulate" && s.tabTextActive]}>Simulate</Text>
            </Pressable>
            <Pressable
              style={[s.tab, activeTab === "saved" && s.tabActive]}
              onPress={() => handleTabChange("saved")}
            >
              <Text style={[s.tabText, activeTab === "saved" && s.tabTextActive]}>Saved</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {activeTab === "simulate" ? (
              <View style={s.body}>
                {/* Preset chips */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={s.presetsRow}
                >
                  {presets.map((p) => (
                    <Pressable
                      key={p.type}
                      style={[s.presetChip, selectedPreset === p.type && s.presetChipActive]}
                      onPress={() => selectPreset(p.type)}
                    >
                      <Ionicons
                        name={SCENARIO_ICONS[p.type] as any}
                        size={14}
                        color={selectedPreset === p.type ? "#000" : C.textSecondary}
                      />
                      <Text style={[s.presetChipText, selectedPreset === p.type && s.presetChipTextActive]}>
                        {p.label}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {/* Label for Custom */}
                {params.type === "custom" && (
                  <View style={s.fieldRow}>
                    <Text style={s.fieldLabel}>Scenario Name</Text>
                    <TextInput
                      style={s.input}
                      value={params.label}
                      onChangeText={(v) => setParams((prev) => ({ ...prev, label: v }))}
                      placeholder="e.g. Start a Business"
                      placeholderTextColor={C.textMuted}
                    />
                  </View>
                )}

                {/* Param inputs */}
                <View style={s.inputGrid}>
                  <View style={s.inputCell}>
                    <Text style={s.fieldLabel}>Income Change / mo</Text>
                    <TextInput
                      style={s.input}
                      value={params.monthlyIncomeChange === 0 ? "" : String(params.monthlyIncomeChange)}
                      onChangeText={(v) => updateParam("monthlyIncomeChange", v)}
                      placeholder="e.g. -5000"
                      placeholderTextColor={C.textMuted}
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                  <View style={s.inputCell}>
                    <Text style={s.fieldLabel}>Expense Change / mo</Text>
                    <TextInput
                      style={s.input}
                      value={params.monthlyExpenseChange === 0 ? "" : String(params.monthlyExpenseChange)}
                      onChangeText={(v) => updateParam("monthlyExpenseChange", v)}
                      placeholder="e.g. 2500"
                      placeholderTextColor={C.textMuted}
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                  <View style={s.inputCell}>
                    <Text style={s.fieldLabel}>One-Time Cost ($)</Text>
                    <TextInput
                      style={s.input}
                      value={params.oneTimeCost === 0 ? "" : String(params.oneTimeCost)}
                      onChangeText={(v) => updateParam("oneTimeCost", v)}
                      placeholder="e.g. 50000"
                      placeholderTextColor={C.textMuted}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={s.inputCell}>
                    <Text style={s.fieldLabel}>Duration (months)</Text>
                    <TextInput
                      style={s.input}
                      value={params.durationMonths === 0 ? "" : String(params.durationMonths)}
                      onChangeText={(v) => updateParam("durationMonths", v)}
                      placeholder="e.g. 12"
                      placeholderTextColor={C.textMuted}
                      keyboardType="numeric"
                    />
                  </View>
                </View>

                {/* Chart */}
                <View style={s.chartCard}>
                  <View style={s.chartLegend}>
                    <View style={s.legendItem}>
                      <View style={[s.legendLine, { backgroundColor: C.tint }]} />
                      <Text style={s.legendText}>Baseline</Text>
                    </View>
                    <View style={s.legendItem}>
                      <View style={[s.legendLineDashed, { borderColor: C.gold }]} />
                      <Text style={[s.legendText, { color: C.gold }]}>Scenario</Text>
                    </View>
                  </View>
                  {Platform.OS !== "web" ? (
                    <ScenarioChart result={result} width={chartWidth} />
                  ) : (
                    <View style={[s.webChartFallback, { width: chartWidth, height: CHART_H }]}>
                      <Text style={s.webChartText}>Chart available on mobile</Text>
                    </View>
                  )}
                </View>

                {/* Stats */}
                <View style={s.statsRow}>
                  <StatChip
                    label="Net Impact"
                    value={`${result.netImpact >= 0 ? "+" : ""}${formatCAD(result.netImpact)}`}
                    positive={netImpactPositive}
                  />
                  <StatChip
                    label="Break Even"
                    value={result.breakEvenMonths ? `${result.breakEvenMonths} mo` : "N/A"}
                    positive={result.breakEvenMonths !== null}
                  />
                  <StatChip
                    label="Lowest Point"
                    value={formatCAD(result.lowestPoint)}
                    positive={result.lowestPoint >= 0}
                  />
                </View>

                {/* AI Summary */}
                <View style={s.aiCard}>
                  <View style={s.aiHeader}>
                    <Ionicons name="sparkles" size={14} color={C.gold} />
                    <Text style={s.aiTitle}>Thrive Analysis</Text>
                  </View>
                  {aiSummary ? (
                    <Text style={s.aiText}>{aiSummary}</Text>
                  ) : (
                    <Pressable style={s.aiBtn} onPress={fetchAiSummary} disabled={aiLoading}>
                      {aiLoading ? (
                        <ActivityIndicator size="small" color={C.gold} />
                      ) : (
                        <>
                          <Ionicons name="flash-outline" size={14} color={C.gold} />
                          <Text style={s.aiBtnText}>Analyze this scenario</Text>
                        </>
                      )}
                    </Pressable>
                  )}
                </View>

                {/* Action buttons */}
                <View style={s.actions}>
                  <Pressable style={s.saveBtn} onPress={handleSave} disabled={saveLoading}>
                    {saveLoading ? (
                      <ActivityIndicator size="small" color="#000" />
                    ) : (
                      <>
                        <Ionicons name="bookmark-outline" size={15} color="#000" />
                        <Text style={s.saveBtnText}>Save Scenario</Text>
                        {!isPremium && (
                          <View style={s.freeBadge}>
                            <Text style={s.freeBadgeText}>2 free</Text>
                          </View>
                        )}
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={s.body}>
                {savedLoading ? (
                  <ActivityIndicator size="large" color={C.tint} style={{ marginTop: 40 }} />
                ) : savedScenarios.length === 0 ? (
                  <View style={s.emptyState}>
                    <Ionicons name="analytics-outline" size={40} color={C.textMuted} />
                    <Text style={s.emptyStateText}>No saved scenarios yet</Text>
                    <Text style={s.emptyStateSubtext}>Run a simulation and tap &quot;Save Scenario&quot;</Text>
                  </View>
                ) : (
                  savedScenarios.map((sc) => (
                    <Pressable key={sc.id} style={s.savedCard} onPress={() => loadSavedScenario(sc)}>
                      <View style={s.savedCardLeft}>
                        <View style={s.savedIconWrap}>
                          <Ionicons name={SCENARIO_ICONS[sc.type] as any} size={18} color={C.tint} />
                        </View>
                        <View>
                          <Text style={s.savedLabel}>{sc.label}</Text>
                          <Text style={s.savedDate}>
                            {new Date(sc.createdAt).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
                          </Text>
                        </View>
                      </View>
                      <View style={s.savedRight}>
                        <Text style={[s.savedImpact, sc.netImpact >= 0 ? s.pos : s.neg]}>
                          {sc.netImpact >= 0 ? "+" : ""}{formatCAD(sc.netImpact)}
                        </Text>
                        <Pressable onPress={() => handleDeleteSaved(sc)} hitSlop={8} style={{ marginLeft: 10 }}>
                          <Ionicons name="trash-outline" size={16} color={C.textMuted} />
                        </Pressable>
                      </View>
                    </Pressable>
                  ))
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "92%",
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: C.text,
  },
  tabRow: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: C.elevated,
    borderRadius: 10,
    padding: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: 7,
    alignItems: "center",
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: C.tint,
  },
  tabText: {
    fontSize: 13,
    color: C.textSecondary,
    fontWeight: "600",
  },
  tabTextActive: {
    color: "#000",
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  presetsRow: {
    gap: 8,
    paddingBottom: 12,
  },
  presetChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.elevated,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: C.border,
  },
  presetChipActive: {
    backgroundColor: C.tint,
    borderColor: C.tint,
  },
  presetChipText: {
    fontSize: 12,
    color: C.textSecondary,
    fontWeight: "600",
  },
  presetChipTextActive: {
    color: "#000",
  },
  fieldRow: {
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 11,
    color: C.textMuted,
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: C.elevated,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  inputGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -4,
    marginBottom: 12,
  },
  inputCell: {
    width: "50%",
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  chartCard: {
    backgroundColor: C.elevated,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  chartLegend: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendLine: {
    width: 16,
    height: 2,
    borderRadius: 1,
  },
  legendLineDashed: {
    width: 16,
    height: 0,
    borderTopWidth: 2,
    borderStyle: "dashed",
    borderRadius: 1,
  },
  legendText: {
    fontSize: 11,
    color: C.textSecondary,
  },
  webChartFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.card,
    borderRadius: 8,
  },
  webChartText: {
    color: C.textMuted,
    fontSize: 13,
  },
  statsRow: {
    flexDirection: "row",
    marginHorizontal: -3,
    marginBottom: 12,
  },
  aiCard: {
    backgroundColor: C.elevated,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.borderStrong,
  },
  aiHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  aiTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: C.gold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  aiText: {
    fontSize: 13,
    color: C.textSecondary,
    lineHeight: 19,
  },
  aiBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.card,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: "flex-start",
  },
  aiBtnText: {
    fontSize: 13,
    color: C.gold,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 4,
  },
  saveBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: C.tint,
    borderRadius: 12,
    paddingVertical: 13,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#000",
  },
  freeBadge: {
    backgroundColor: "rgba(0,0,0,0.18)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  freeBadgeText: {
    fontSize: 10,
    color: "#000",
    fontWeight: "700",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 8,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: "600",
    color: C.textSecondary,
  },
  emptyStateSubtext: {
    fontSize: 13,
    color: C.textMuted,
    textAlign: "center",
  },
  savedCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: C.elevated,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  savedCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  savedIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
  },
  savedLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: C.text,
  },
  savedDate: {
    fontSize: 11,
    color: C.textMuted,
    marginTop: 2,
  },
  savedRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  savedImpact: {
    fontSize: 14,
    fontWeight: "700",
  },
  pos: { color: C.tint },
  neg: { color: "#FF6B6B" },
});
