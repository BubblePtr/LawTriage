export type AgentReplyConversationItem = {
  createdAt?: number;
  id?: string;
  role?: string;
  textContent?: string;
  type?: string;
};

export type AgentReplyStreamPayload = {
  id: string;
  role: "assistant";
  text: string;
  timestamp: number;
};

export function createAgentReplyStreamPayload(
  item: AgentReplyConversationItem,
): AgentReplyStreamPayload | undefined {
  if (item.type !== "message" || item.role !== "assistant") {
    return undefined;
  }

  const text = normalizeReplyText(item.textContent ?? "");

  if (!text) {
    return undefined;
  }

  return {
    id: item.id || `assistant-${item.createdAt ?? Date.now()}`,
    role: "assistant",
    text,
    timestamp: item.createdAt ?? Date.now(),
  };
}

function normalizeReplyText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
