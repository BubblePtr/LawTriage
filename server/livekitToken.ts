import { createHmac, randomUUID } from "node:crypto";

export type LiveKitTokenEnv = {
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
  LIVEKIT_PARTICIPANT_TOKEN_TTL_SECONDS?: string;
  LIVEKIT_URL?: string;
};

export type LiveKitParticipantTokenRequest = {
  identity?: string;
  name?: string;
  now?: Date;
  roomName?: string;
  ttlSeconds?: number;
};

export type LiveKitParticipantTokenResponse = {
  expiresAt: string;
  identity: string;
  roomName: string;
  token: string;
  url: string;
};

const defaultTokenTtlSeconds = 30 * 60;

export function createLiveKitParticipantToken(
  request: LiveKitParticipantTokenRequest,
  env: LiveKitTokenEnv,
): LiveKitParticipantTokenResponse {
  const url = requireEnv(env.LIVEKIT_URL, "LIVEKIT_URL");
  const apiKey = requireEnv(env.LIVEKIT_API_KEY, "LIVEKIT_API_KEY");
  const apiSecret = requireEnv(env.LIVEKIT_API_SECRET, "LIVEKIT_API_SECRET");
  const nowSeconds = Math.floor((request.now ?? new Date()).getTime() / 1000);
  const ttlSeconds = normalizeTtlSeconds(request.ttlSeconds, env.LIVEKIT_PARTICIPANT_TOKEN_TTL_SECONDS);
  const roomName = normalizeIdentifier(request.roomName, `law-triage-${randomUUID()}`);
  const identity = normalizeIdentifier(request.identity, `browser-${randomUUID()}`);
  const expiresAtSeconds = nowSeconds + ttlSeconds;
  const payload = {
    exp: expiresAtSeconds,
    iss: apiKey,
    name: request.name?.trim() || identity,
    nbf: nowSeconds,
    sub: identity,
    video: {
      canPublish: true,
      canPublishSources: ["microphone"],
      canSubscribe: true,
      room: roomName,
      roomJoin: true,
    },
  };

  return {
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    identity,
    roomName,
    token: signJwt(payload, apiSecret),
    url,
  };
}

function signJwt(payload: Record<string, unknown>, apiSecret: string): string {
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const signatureInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createHmac("sha256", apiSecret).update(signatureInput).digest("base64url");

  return `${signatureInput}.${signature}`;
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function normalizeTtlSeconds(requestedTtl?: number, envTtl?: string): number {
  const parsed = requestedTtl ?? Number.parseInt(envTtl ?? "", 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultTokenTtlSeconds;
  }

  return Math.min(Math.floor(parsed), 24 * 60 * 60);
}

function normalizeIdentifier(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function requireEnv(value: string | undefined, name: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(`缺少 ${name}。`);
  }

  return normalized;
}
