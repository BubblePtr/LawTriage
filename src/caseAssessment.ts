import { getTriageSlotValue } from "./triageSlots";
import type { CaseGrade, IntakeForm, RiskLevel, TranscriptEvent, TriageSlotSnapshot } from "./types";

type CaseAssessment = {
  grading: {
    level: CaseGrade;
    reason: string;
  };
  risk: {
    level: RiskLevel;
    note: string;
  };
};

type RiskRule = {
  level: Exclude<RiskLevel, "正常">;
  keywords: string[];
  note: string;
};

const gradingRules = {
  mediumAmountYuan: 500_000,
  largeAmountYuan: 3_000_000,
  mediumSignals: ["孩子", "抚养", "房产", "房贷", "公司", "股权", "财产转移"],
  urgentSignals: ["尽快", "今天", "明天", "财产保全", "人身威胁"],
};

const riskRules: RiskRule[] = [
  {
    level: "恶意",
    keywords: ["恐吓", "报复", "伪造", "黑客", "骚扰", "骗钱", "吓唬"],
    note: "命中恶意或违法协助诉求，应中止自动承接并交由人工复核。",
  },
  {
    level: "敏感",
    keywords: ["家暴", "人身威胁", "自杀", "伤害", "孩子安全", "未成年人", "保护令"],
    note: "命中人身安全、未成年人或紧急保护相关词，应优先提示人工跟进。",
  },
  {
    level: "无效",
    keywords: ["天气", "快递", "外卖", "彩票", "股票推荐", "不是法律咨询", "测试系统"],
    note: "命中非法律咨询或明显测试内容，可标为无效线索。",
  },
];

export function assessCase(
  intake: IntakeForm,
  transcript: TranscriptEvent[],
  triageSlots: TriageSlotSnapshot,
): CaseAssessment {
  const fullText = [intake.clientName, intake.city, intake.caseType, ...transcript.map((event) => event.text)].join(
    "\n",
  );
  const amountYuan = extractHighestAmountYuan(fullText);
  const urgency = getTriageSlotValue(triageSlots, "urgency");
  const gradeSignals = collectSignals(fullText, [...gradingRules.mediumSignals, ...gradingRules.urgentSignals]);
  const grading = gradeCase(amountYuan, urgency, gradeSignals);
  const risk = assessRisk(fullText);

  return {
    grading,
    risk,
  };
}

function gradeCase(amountYuan: number, urgency: string, signals: string[]): CaseAssessment["grading"] {
  if (amountYuan >= gradingRules.largeAmountYuan) {
    return {
      level: "大",
      reason: `争议标的约 ${formatYuan(amountYuan)}，达到大案阈值 ${formatYuan(
        gradingRules.largeAmountYuan,
      )}；已识别信号：${formatSignals(signals)}。`,
    };
  }

  if (
    amountYuan >= gradingRules.mediumAmountYuan ||
    signals.some((signal) => gradingRules.mediumSignals.includes(signal)) ||
    urgency.startsWith("高")
  ) {
    return {
      level: "中",
      reason: `争议标的约 ${formatYuan(amountYuan)}，并出现 ${formatSignals(
        signals,
      )} 等复杂或紧急信号；建议进入律师评估。`,
    };
  }

  return {
    level: "小",
    reason: `未识别高标的或复杂风险信号，争议标的约 ${formatYuan(amountYuan)}；可按常规咨询承接。`,
  };
}

function assessRisk(fullText: string): CaseAssessment["risk"] {
  for (const rule of riskRules) {
    const matched = rule.keywords.find((keyword) => fullText.includes(keyword));

    if (matched) {
      return {
        level: rule.level,
        note: `${rule.note} 命中词：${matched}。`,
      };
    }
  }

  return {
    level: "正常",
    note: "未触发敏感、无效或恶意咨询规则。",
  };
}

function collectSignals(fullText: string, candidates: string[]): string[] {
  return candidates.filter((signal) => fullText.includes(signal));
}

function extractHighestAmountYuan(text: string): number {
  const amounts: number[] = [];

  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(百万|万)/g)) {
    const value = Number(match[1]);
    amounts.push(match[2] === "百万" ? value * 1_000_000 : value * 10_000);
  }

  for (const match of text.matchAll(/([一二两三四五六七八九十]+)(百万|万)/g)) {
    const value = parseChineseInteger(match[1]);
    amounts.push(match[2] === "百万" ? value * 1_000_000 : value * 10_000);
  }

  if (text.includes("几十万")) {
    amounts.push(300_000);
  }
  if (text.includes("上千万")) {
    amounts.push(10_000_000);
  }

  return Math.max(0, ...amounts);
}

function parseChineseInteger(value: string): number {
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (value === "十") {
    return 10;
  }

  if (value.includes("十")) {
    const [tens, ones] = value.split("十");
    return (digits[tens] ?? 1) * 10 + (digits[ones] ?? 0);
  }

  return digits[value] ?? 0;
}

function formatYuan(value: number): string {
  if (value <= 0) {
    return "未明确";
  }

  if (value >= 10_000) {
    return `${Math.round(value / 10_000)} 万元`;
  }

  return `${value} 元`;
}

function formatSignals(signals: string[]): string {
  return signals.length > 0 ? signals.join("、") : "无明显复杂信号";
}
