/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENT_PROVIDER?: "dev" | "openai" | "volcengine";
  readonly VITE_LIVEKIT_TOKEN?: string;
  readonly VITE_LIVEKIT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
