import type { DemoSession, IntakeForm, StructuredResult } from "./types";

const sessionDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function createDemoSession(intake: IntakeForm): DemoSession {
  return {
    id: createSessionId(),
    status: "active",
    intake: { ...intake },
    startedAt: new Date(),
  };
}

export function endDemoSession(session: DemoSession): DemoSession {
  const endedAt = new Date();

  return {
    ...session,
    status: "ended",
    endedAt,
    structuredResult: createStructuredResult(session.intake),
  };
}

export function formatDateTime(date?: Date): string {
  if (!date) {
    return "-";
  }

  return sessionDateFormatter.format(date);
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function createSessionId(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    (now.getMonth() + 1).toString().padStart(2, "0"),
    now.getDate().toString().padStart(2, "0"),
  ].join("");
  const suffix = Math.random().toString(16).slice(2, 6).toUpperCase();

  return `CALL-${date}-${suffix}`;
}

function createStructuredResult(intake: IntakeForm): StructuredResult {
  return {
    clientProfile: {
      name: intake.clientName,
      phone: intake.phone,
      caseType: intake.caseType,
      city: intake.city,
      coreNeed: "婚姻家事初步咨询，需进一步确认财产线索与沟通时间。",
      hasLawyer: "未确认",
    },
    grading: {
      level: "中",
      reason: "演示占位：案件类型明确，信息已留存，标的额和紧急程度待后续分诊槽位补全。",
    },
    appointment: {
      needed: "是",
      time: "待律师助理回访确认",
      location: "线上或到所沟通",
    },
    risk: {
      level: "正常",
      note: "未触发敏感、无效或恶意咨询规则。",
    },
  };
}
