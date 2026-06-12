import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { createLiveKitParticipantToken } from "../server/livekitToken";

describe("createLiveKitParticipantToken", () => {
  test("signs a browser participant token with room and microphone grants", () => {
    const issuedAt = new Date("2026-06-12T10:00:00.000Z");
    const result = createLiveKitParticipantToken(
      {
        identity: "demo-browser",
        name: "Demo Browser",
        now: issuedAt,
        roomName: "law-triage-demo",
        ttlSeconds: 900,
      },
      {
        LIVEKIT_API_KEY: "API_test_key",
        LIVEKIT_API_SECRET: "secret-value",
        LIVEKIT_URL: "wss://example.livekit.cloud",
      },
    );

    const { header, payload, signatureInput, signature } = decodeJwt(result.token);
    const expectedSignature = createHmac("sha256", "secret-value").update(signatureInput).digest("base64url");

    expect(result.url).toBe("wss://example.livekit.cloud");
    expect(result.roomName).toBe("law-triage-demo");
    expect(result.identity).toBe("demo-browser");
    expect(result.expiresAt).toBe("2026-06-12T10:15:00.000Z");
    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(signature).toBe(expectedSignature);
    expect(payload).toMatchObject({
      exp: 1_781_259_300,
      iss: "API_test_key",
      name: "Demo Browser",
      nbf: 1_781_258_400,
      sub: "demo-browser",
      video: {
        canPublish: true,
        canPublishSources: ["microphone"],
        canSubscribe: true,
        room: "law-triage-demo",
        roomJoin: true,
      },
    });
  });

  test("requires server-side LiveKit credentials", () => {
    expect(() =>
      createLiveKitParticipantToken(
        {
          identity: "demo-browser",
          roomName: "law-triage-demo",
        },
        {},
      ),
    ).toThrow("缺少 LIVEKIT_URL");
  });
});

function decodeJwt(token: string): {
  header: unknown;
  payload: Record<string, unknown>;
  signature: string;
  signatureInput: string;
} {
  const [headerPart, payloadPart, signature] = token.split(".");

  if (!headerPart || !payloadPart || !signature) {
    throw new Error("Invalid JWT");
  }

  return {
    header: JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as unknown,
    payload: JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Record<string, unknown>,
    signature,
    signatureInput: `${headerPart}.${payloadPart}`,
  };
}
