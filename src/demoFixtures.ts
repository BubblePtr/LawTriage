import type { CaseGrade, DemoScenarioSnapshot, IntakeForm, RiskLevel } from "./types";

export type DemoFixture = {
  id: string;
  name: string;
  description: string;
  intake: IntakeForm;
  clientTranscript: string[];
  expected: {
    grade: CaseGrade;
    risk: RiskLevel;
    focus: string;
  };
};

export const demoFixtures: DemoFixture[] = [
  {
    id: "standard-divorce-property",
    name: "标准婚家咨询",
    description: "离婚、共同房产、存款转移和预约沟通的标准闭环。",
    intake: {
      phone: "138 0013 8000",
      caseType: "婚姻家事",
      clientName: "李女士",
      city: "上海市",
    },
    clientTranscript: [
      "你好，我是李女士，人在上海市，想咨询离婚和财产分割的问题。",
      "已经分居三个月，有一套共同房产，还有一个孩子，主要担心对方转移存款。",
      "房子大概四百万，还有几十万存款。我想尽快跟律师聊一下。",
      "我还没请律师，可以，那帮我安排明天下午沟通吧。",
    ],
    expected: {
      grade: "大",
      risk: "正常",
      focus: "高标的婚家纠纷，适合展示完整分诊闭环。",
    },
  },
  {
    id: "professional-follow-up",
    name: "含专业追问咨询",
    description: "围绕股权、房贷、证据材料和财产保全做更专业的追问。",
    intake: {
      phone: "139 0013 9000",
      caseType: "婚姻家事",
      clientName: "王先生",
      city: "深圳市",
    },
    clientTranscript: [
      "你好，我是王先生，人在深圳市，想咨询离婚时公司股权和房贷怎么处理。",
      "婚后公司估值可能有八百万，房子还有贷款，孩子主要跟我生活。",
      "我已经有律师朋友简单看过，但还没正式委托，担心对方把公司流水转出去。",
      "希望下周二上午和律师细聊，我可以准备股权协议、银行流水和房贷合同。",
    ],
    expected: {
      grade: "大",
      risk: "正常",
      focus: "复杂财产和证据材料，适合展示专业追问与分级依据。",
    },
  },
  {
    id: "sensitive-safety",
    name: "敏感风险咨询",
    description: "涉及家暴、人身威胁和未成年人安全，触发敏感风险标记。",
    intake: {
      phone: "137 0013 7000",
      caseType: "婚姻家事",
      clientName: "赵女士",
      city: "杭州市",
    },
    clientTranscript: [
      "你好，我是赵女士，人在杭州市，想咨询离婚和孩子抚养。",
      "对方最近有家暴和人身威胁，我担心孩子安全，也怕他今晚来找我。",
      "我们有一套小房子，存款不多，但我想尽快知道怎么申请保护和固定证据。",
      "我没有律师，希望今天晚上或者明天上午能有人联系我。",
    ],
    expected: {
      grade: "中",
      risk: "敏感",
      focus: "人身安全和未成年人保护，适合展示敏感风险 fallback。",
    },
  },
];

export function getDefaultDemoFixture(): DemoFixture {
  return demoFixtures[0];
}

export function getDemoFixture(id: string): DemoFixture {
  return demoFixtures.find((fixture) => fixture.id === id) ?? getDefaultDemoFixture();
}

export function createDemoScenarioSnapshot(fixture: DemoFixture): DemoScenarioSnapshot {
  return {
    id: fixture.id,
    name: fixture.name,
    clientTranscript: [...fixture.clientTranscript],
  };
}
