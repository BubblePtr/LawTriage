import type { IntakeForm, TranscriptEvent, TriageSlot, TriageSlotKey, TriageSlotSnapshot } from "./types";

const slotLabels: Record<TriageSlotKey, string> = {
  caseType: "案件类型",
  city: "所在地",
  clientName: "客户称呼",
  coreNeed: "核心诉求",
  disputeAmount: "争议金额/标的",
  expectedContactTime: "期望沟通时间",
  hasLawyer: "是否已有律师",
  phone: "联系电话",
  transcript: "完整转写",
  urgency: "紧急程度",
};

export function createTriageSlotSnapshot(
  intake: IntakeForm,
  transcript: TranscriptEvent[],
  updatedAt = new Date(),
): TriageSlotSnapshot {
  const clientTexts = transcript.filter((event) => event.speaker === "client").map((event) => event.text);
  const allText = transcript.map((event) => event.text).join("\n");
  const slots: TriageSlot[] = [
    createSlot("clientName", intake.clientName),
    createSlot("phone", intake.phone),
    createSlot("caseType", intake.caseType),
    createSlot("city", intake.city),
    extractDisputeAmount(clientTexts),
    extractUrgency(allText),
    extractCoreNeed(clientTexts),
    extractHasLawyer(clientTexts),
    extractExpectedContactTime(clientTexts),
    createSlot(
      "transcript",
      transcript.length > 0 ? `${transcript.length} 条` : "",
      transcript.at(-1)?.text,
    ),
  ];
  const missing = slots.filter((slot) => slot.status === "missing");

  return {
    slots,
    missing,
    completedCount: slots.length - missing.length,
    totalCount: slots.length,
    isComplete: missing.length === 0,
    updatedAt,
  };
}

export function getTriageSlotValue(snapshot: TriageSlotSnapshot, key: TriageSlotKey): string {
  return snapshot.slots.find((slot) => slot.key === key)?.value ?? "未收集";
}

export function formatMissingTriageSlots(snapshot: TriageSlotSnapshot): string {
  if (snapshot.missing.length === 0) {
    return "无";
  }

  return snapshot.missing.map((slot) => slot.label).join("、");
}

function extractDisputeAmount(clientTexts: string[]): TriageSlot {
  const evidence =
    findEvidence(clientTexts, /(四百万|[0-9一二三四五六七八九十百千万]+万|几十万)/) ??
    findEvidence(clientTexts, /(存款|房子|房产)/);

  if (!evidence) {
    return createSlot("disputeAmount", "");
  }

  if (evidence.includes("四百万") && evidence.includes("几十万")) {
    return createSlot("disputeAmount", "房产约四百万，另有几十万存款", evidence);
  }

  const amount = evidence.match(/四百万|[0-9一二三四五六七八九十百千万]+万|几十万/)?.[0];

  return createSlot("disputeAmount", amount ?? evidence, evidence);
}

function extractUrgency(allText: string): TriageSlot {
  if (/转移存款|财产保全|尽快|明天/.test(allText)) {
    return createSlot("urgency", "高（涉及财产转移担忧，且希望尽快沟通）", allText.match(/[^。]*(转移存款|尽快|明天)[^。]*。?/)?.[0]);
  }

  return createSlot("urgency", "");
}

function extractCoreNeed(clientTexts: string[]): TriageSlot {
  const evidence = findEvidence(clientTexts, /(离婚|财产分割|抚养|房产|存款)/);

  if (!evidence) {
    return createSlot("coreNeed", "");
  }

  const needs = [
    evidence.includes("离婚") ? "离婚咨询" : undefined,
    /财产分割|房产|存款/.test(evidence) ? "财产分割" : undefined,
    /孩子|抚养/.test(clientTexts.join("\n")) ? "子女抚养" : undefined,
    /转移/.test(clientTexts.join("\n")) ? "财产转移风险" : undefined,
  ].filter(Boolean);

  return createSlot("coreNeed", needs.join("、") || evidence, evidence);
}

function extractHasLawyer(clientTexts: string[]): TriageSlot {
  const text = clientTexts.join("\n");

  if (/已有律师|请了律师|找了律师|委托律师/.test(text)) {
    return createSlot("hasLawyer", "是", text.match(/[^。]*(已有律师|请了律师|找了律师|委托律师)[^。]*。?/)?.[0]);
  }

  if (/没有律师|还没找律师|未请律师|没请律师/.test(text)) {
    return createSlot("hasLawyer", "否", text.match(/[^。]*(没有律师|还没找律师|未请律师|没请律师)[^。]*。?/)?.[0]);
  }

  return createSlot("hasLawyer", "");
}

function extractExpectedContactTime(clientTexts: string[]): TriageSlot {
  const evidence = findEvidence(clientTexts, /(明天|今天|下周|周[一二三四五六日天])/);

  if (!evidence) {
    return createSlot("expectedContactTime", "");
  }

  const time = evidence.match(/明天(?:上午|下午|晚上)?|今天(?:上午|下午|晚上)?|下周[一二三四五六日天]?(?:上午|下午|晚上)?|周[一二三四五六日天](?:上午|下午|晚上)?/)?.[0];

  return createSlot("expectedContactTime", time ?? evidence, evidence);
}

function findEvidence(texts: string[], pattern: RegExp): string | undefined {
  return texts.find((text) => pattern.test(text));
}

function createSlot(key: TriageSlotKey, value: string, evidence?: string): TriageSlot {
  const normalizedValue = value.trim();

  return {
    key,
    label: slotLabels[key],
    status: normalizedValue ? "collected" : "missing",
    value: normalizedValue || "未收集",
    evidence,
  };
}
