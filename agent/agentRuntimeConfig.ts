import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type AgentProviderMode = "inference" | "volcengine";

type EnvRecord = Record<string, string | undefined>;

const dotenvFiles = [".env", ".env.local"];

export function resolveAgentProviderMode(env: EnvRecord = process.env): AgentProviderMode {
  const explicitMode = normalizeProviderMode(env.AGENT_PROVIDER);

  if (explicitMode) {
    return explicitMode;
  }

  const viteMode = normalizeProviderMode(env.VITE_AGENT_PROVIDER);

  if (viteMode === "volcengine") {
    return "volcengine";
  }

  if (hasVolcengineChain(env)) {
    return "volcengine";
  }

  return "inference";
}

export function loadLocalEnvFiles(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env) {
  const parsed: Record<string, string> = {};

  for (const filename of dotenvFiles) {
    const path = join(cwd, filename);

    if (existsSync(path)) {
      Object.assign(parsed, parseEnvFileText(readFileSync(path, "utf8")));
    }
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) {
      env[key] = value;
    }
  }
}

export function parseEnvFileText(text: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const assignment = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const separatorIndex = assignment.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = assignment.slice(0, separatorIndex).trim();
    const rawValue = assignment.slice(separatorIndex + 1).trim();

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    values[key] = unquoteEnvValue(rawValue);
  }

  return values;
}

function normalizeProviderMode(value?: string): AgentProviderMode | undefined {
  const mode = value?.trim().toLowerCase();

  if (!mode || mode === "dev") {
    return undefined;
  }

  if (mode === "volcengine") {
    return "volcengine";
  }

  if (mode === "inference" || mode === "livekit" || mode === "livekit-inference") {
    return "inference";
  }

  throw new Error(`Unsupported LiveKit Agent provider mode: ${value}`);
}

function hasVolcengineChain(env: EnvRecord): boolean {
  return Boolean(env.ARK_API_KEY?.trim() && env.VOLC_ASR_API_KEY?.trim() && env.VOLC_TTS_API_KEY?.trim());
}

function unquoteEnvValue(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];

    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }

  return value;
}
