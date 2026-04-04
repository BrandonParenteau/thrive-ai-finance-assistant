import React, { useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system/next";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { getFunctionsUrl } from "@/lib/functions";
import { fetch } from "expo/fetch";

const C = Colors.dark;

interface ParsedTransaction {
  date: string;
  description: string;
  amount: number;
  category: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onImport: (transactions: ParsedTransaction[]) => Promise<void>;
}

export default function StatementUploadModal({ visible, onClose, onImport }: Props) {
  const { token } = useAuth();
  const [step, setStep] = useState<"pick" | "preview" | "importing">("pick");
  const [parsed, setParsed] = useState<ParsedTransaction[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");

  const reset = () => {
    setStep("pick");
    setParsed([]);
    setSelected(new Set());
    setFileName("");
    setLoading(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const pickAndParse = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/plain", "application/pdf", "application/octet-stream"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setFileName(asset.name);
      setLoading(true);

      const ext = asset.name.split(".").pop()?.toLowerCase();
      const file = new File(asset.uri);
      let body: Record<string, string>;
      if (ext === "pdf") {
        const base64 = await file.base64();
        body = { pdfBase64: base64 };
      } else {
        const text = await file.text();
        body = { text };
      }

      const resp = await fetch(`${getFunctionsUrl()}/parseStatement`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Server error: ${err}`);
      }

      const data = await resp.json();
      const txs: ParsedTransaction[] = data.transactions ?? [];

      if (txs.length === 0) {
        Alert.alert("No Transactions Found", "Couldn't extract any transactions from this file. Try a CSV export instead.");
        setLoading(false);
        return;
      }

      setParsed(txs);
      setSelected(new Set(txs.map((_, i) => i)));
      setStep("preview");
    } catch (err: any) {
      console.error("parseStatement error:", err);
      Alert.alert("Error", err.message || "Failed to parse statement.");
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const handleImport = async () => {
    const toImport = parsed.filter((_, i) => selected.has(i));
    if (toImport.length === 0) { Alert.alert("Nothing selected"); return; }
    setStep("importing");
    try {
      await onImport(toImport);
      Alert.alert("Imported", `${toImport.length} transaction${toImport.length !== 1 ? "s" : ""} added.`);
      handleClose();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Import failed.");
      setStep("preview");
    }
  };

  const formatAmt = (v: number) => {
    const abs = Math.abs(v);
    const s = v < 0 ? "-$" : "+$";
    return `${s}${abs.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          <View style={s.header}>
            <Text style={s.title}>
              {step === "pick" ? "Upload Statement" : step === "importing" ? "Importing…" : `Preview (${fileName})`}
            </Text>
            <Pressable onPress={handleClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={C.textSecondary} />
            </Pressable>
          </View>

          {step === "pick" && (
            <View style={s.pickBody}>
              <View style={s.uploadArea}>
                <Ionicons name="document-text-outline" size={48} color={C.textMuted} />
                <Text style={s.uploadTitle}>PDF or CSV</Text>
                <Text style={s.uploadSubtitle}>
                  Upload a bank statement PDF or CSV export. Transactions will be automatically extracted and categorized.
                </Text>
              </View>
              <View style={s.tipBox}>
                <Ionicons name="information-circle-outline" size={15} color={C.tint} />
                <Text style={s.tipText}>
                  Most Canadian banks offer a CSV export under &quot;Download transactions&quot; or &quot;Export statement&quot;.
                </Text>
              </View>
              <Pressable style={s.pickBtn} onPress={pickAndParse} disabled={loading}>
                {loading ? (
                  <>
                    <ActivityIndicator size="small" color="#000" />
                    <Text style={s.pickBtnText}>Analyzing…</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={18} color="#000" />
                    <Text style={s.pickBtnText}>Choose File</Text>
                  </>
                )}
              </Pressable>
            </View>
          )}

          {step === "preview" && (
            <>
              <View style={s.previewMeta}>
                <Text style={s.previewCount}>
                  {selected.size} of {parsed.length} transactions selected
                </Text>
                <Pressable
                  onPress={() =>
                    selected.size === parsed.length
                      ? setSelected(new Set())
                      : setSelected(new Set(parsed.map((_, i) => i)))
                  }
                >
                  <Text style={s.selectAllText}>
                    {selected.size === parsed.length ? "Deselect all" : "Select all"}
                  </Text>
                </Pressable>
              </View>

              <ScrollView style={s.previewList} showsVerticalScrollIndicator={false}>
                {parsed.map((tx, i) => (
                  <Pressable key={i} style={s.previewRow} onPress={() => toggleRow(i)}>
                    <View style={[s.checkbox, selected.has(i) && s.checkboxSelected]}>
                      {selected.has(i) && <Ionicons name="checkmark" size={12} color="#000" />}
                    </View>
                    <View style={s.previewInfo}>
                      <Text style={s.previewDesc} numberOfLines={1}>{tx.description}</Text>
                      <Text style={s.previewMeta2}>{tx.date} · {tx.category}</Text>
                    </View>
                    <Text style={[s.previewAmt, tx.amount >= 0 ? s.pos : s.neg]}>
                      {formatAmt(tx.amount)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              <View style={s.previewActions}>
                <Pressable style={s.backBtn} onPress={() => { setStep("pick"); setParsed([]); }}>
                  <Text style={s.backBtnText}>Back</Text>
                </Pressable>
                <Pressable style={s.importBtn} onPress={handleImport} disabled={selected.size === 0}>
                  <Ionicons name="checkmark-circle-outline" size={16} color="#000" />
                  <Text style={s.importBtnText}>Import {selected.size}</Text>
                </Pressable>
              </View>
            </>
          )}

          {step === "importing" && (
            <View style={s.importingBody}>
              <ActivityIndicator size="large" color={C.tint} />
              <Text style={s.importingText}>Adding transactions…</Text>
            </View>
          )}
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
    maxHeight: "90%",
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: C.text,
  },
  pickBody: {
    padding: 20,
    gap: 16,
  },
  uploadArea: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 10,
    backgroundColor: C.elevated,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: "dashed",
  },
  uploadTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: C.textSecondary,
  },
  uploadSubtitle: {
    fontSize: 12,
    color: C.textMuted,
    textAlign: "center",
    paddingHorizontal: 24,
    lineHeight: 18,
  },
  tipBox: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: `${C.tint}12`,
    borderRadius: 10,
    padding: 12,
    alignItems: "flex-start",
  },
  tipText: {
    flex: 1,
    fontSize: 12,
    color: C.textSecondary,
    lineHeight: 17,
  },
  pickBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.tint,
    borderRadius: 14,
    paddingVertical: 14,
  },
  pickBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#000",
  },
  previewMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  previewCount: {
    fontSize: 13,
    color: C.textMuted,
  },
  selectAllText: {
    fontSize: 13,
    color: C.tint,
    fontWeight: "600",
  },
  previewList: {
    maxHeight: 420,
    paddingHorizontal: 20,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: C.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: {
    backgroundColor: C.tint,
    borderColor: C.tint,
  },
  previewInfo: {
    flex: 1,
  },
  previewDesc: {
    fontSize: 13,
    fontWeight: "600",
    color: C.text,
  },
  previewMeta2: {
    fontSize: 11,
    color: C.textMuted,
    marginTop: 2,
  },
  previewAmt: {
    fontSize: 13,
    fontWeight: "700",
  },
  pos: { color: C.tint },
  neg: { color: "#FF6B6B" },
  previewActions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  backBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: C.textSecondary,
  },
  importBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: C.tint,
    borderRadius: 12,
    paddingVertical: 13,
  },
  importBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#000",
  },
  importingBody: {
    alignItems: "center",
    paddingVertical: 60,
    gap: 16,
  },
  importingText: {
    fontSize: 15,
    color: C.textSecondary,
  },
});
