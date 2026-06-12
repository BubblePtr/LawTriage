import { AudioFrame } from "@livekit/rtc-node";
import { initializeLogger, stt } from "@livekit/agents";
import { gzipSync } from "node:zlib";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import WebSocket, { WebSocketServer } from "ws";
import { createVolcengineAgentModels } from "../agent/volcengineLiveKitProviders";

let activeServer: WebSocketServer | undefined;

beforeAll(() => {
  initializeLogger({ level: "silent", pretty: false });
});

afterEach(async () => {
  if (activeServer) {
    for (const client of activeServer.clients) {
      client.terminate();
    }
    activeServer.close();
    activeServer = undefined;
  }
});

describe("Volcengine ASR LiveKit stream", () => {
  test("sends a final audio frame on flush so Volcengine can return a definite transcript", async () => {
    const observed = {
      audioFrames: 0,
      finalFrames: 0,
    };
    const server = await startFakeVolcAsrServer(observed);
    activeServer = server;
    const address = server.address();

    if (typeof address === "string" || !address) {
      throw new Error("Fake ASR server did not expose a TCP port.");
    }

    const models = createVolcengineAgentModels({
      VOLC_ASR_API_KEY: "test-asr-key",
      VOLC_ASR_STREAM_WS_URL: `ws://127.0.0.1:${address.port}`,
    });
    const stream = models.stt.stream();
    const eventsPromise = collectUntilEndOfSpeech(stream);

    stream.pushFrame(createSpeechFrame());
    stream.flush();

    const events = await eventsPromise;
    stream.close();

    expect(observed.audioFrames).toBeGreaterThan(0);
    expect(observed.finalFrames).toBe(1);
    expect(events.some((event) => event.type === stt.SpeechEventType.FINAL_TRANSCRIPT)).toBe(true);
    expect(events.at(-1)?.type).toBe(stt.SpeechEventType.END_OF_SPEECH);
    expect(events.at(-1)?.alternatives?.[0]?.text).toBe("我想咨询离婚。");
  });

  test("finalizes a speech turn after trailing silence even when LiveKit does not flush the STT stream", async () => {
    const observed = {
      audioFrames: 0,
      finalFrames: 0,
    };
    const server = await startFakeVolcAsrServer(observed);
    activeServer = server;
    const address = server.address();

    if (typeof address === "string" || !address) {
      throw new Error("Fake ASR server did not expose a TCP port.");
    }

    const models = createVolcengineAgentModels({
      LIVEKIT_AGENT_ASR_TURN_SILENCE_MS: "250",
      VOLC_ASR_API_KEY: "test-asr-key",
      VOLC_ASR_STREAM_WS_URL: `ws://127.0.0.1:${address.port}`,
    });
    const stream = models.stt.stream();
    const eventsPromise = collectUntilEndOfSpeech(stream);

    stream.pushFrame(createSpeechFrame());
    stream.pushFrame(createSilenceFrame());
    stream.pushFrame(createSilenceFrame());
    stream.pushFrame(createSilenceFrame());

    const events = await eventsPromise;
    stream.close();

    expect(observed.audioFrames).toBeGreaterThan(0);
    expect(observed.finalFrames).toBe(1);
    expect(events.some((event) => event.type === stt.SpeechEventType.FINAL_TRANSCRIPT)).toBe(true);
    expect(events.at(-1)?.type).toBe(stt.SpeechEventType.END_OF_SPEECH);
    expect(events.at(-1)?.alternatives?.[0]?.text).toBe("我想咨询离婚。");
  });

  test("does not drop low-level microphone speech before opening the ASR turn", async () => {
    const observed = {
      audioFrames: 0,
      finalFrames: 0,
    };
    const server = await startFakeVolcAsrServer(observed);
    activeServer = server;
    const address = server.address();

    if (typeof address === "string" || !address) {
      throw new Error("Fake ASR server did not expose a TCP port.");
    }

    const models = createVolcengineAgentModels({
      VOLC_ASR_API_KEY: "test-asr-key",
      VOLC_ASR_STREAM_WS_URL: `ws://127.0.0.1:${address.port}`,
    });
    const stream = models.stt.stream();
    const eventsPromise = collectUntilEndOfSpeech(stream);

    stream.pushFrame(createSpeechFrame(120));
    stream.flush();

    const events = await eventsPromise;
    stream.close();

    expect(observed.audioFrames).toBeGreaterThan(0);
    expect(observed.finalFrames).toBe(1);
    expect(events.at(-1)?.type).toBe(stt.SpeechEventType.END_OF_SPEECH);
    expect(events.at(-1)?.alternatives?.[0]?.text).toBe("我想咨询离婚。");
  });
});

function createSpeechFrame(amplitude = 1200): AudioFrame {
  const samples = new Int16Array(1600);

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = index % 20 < 10 ? amplitude : -amplitude;
  }

  return new AudioFrame(samples, 16000, 1, samples.length);
}

function createSilenceFrame(): AudioFrame {
  const samples = new Int16Array(1600);

  return new AudioFrame(samples, 16000, 1, samples.length);
}

async function startFakeVolcAsrServer(observed: { audioFrames: number; finalFrames: number }) {
  const server = new WebSocketServer({ port: 0 });

  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      const buffer = rawDataToBuffer(data);

      if (buffer[1] === 0x20) {
        observed.audioFrames += 1;
      }

      if (buffer[1] === 0x22) {
        observed.finalFrames += 1;
        socket.send(createFakeVolcAsrResponse("我想咨询离婚。"));
        socket.close();
      }
    });
  });

  await new Promise<void>((resolve) => server.once("listening", () => resolve()));

  return server;
}

async function collectUntilEndOfSpeech(stream: stt.SpeechStream): Promise<stt.SpeechEvent[]> {
  const events: stt.SpeechEvent[] = [];
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Timed out waiting for END_OF_SPEECH.")), 1200);
  });
  const collection = (async () => {
    for await (const event of stream) {
      events.push(event);

      if (event.type === stt.SpeechEventType.END_OF_SPEECH) {
        return events;
      }
    }

    return events;
  })();

  return Promise.race([collection, timeout]);
}

function createFakeVolcAsrResponse(text: string): Buffer {
  const payload = gzipSync(
    Buffer.from(
      JSON.stringify({
        result: {
          text,
          utterances: [
            {
              definite: true,
              end_time: 1200,
              start_time: 0,
              text,
            },
          ],
        },
      }),
      "utf8",
    ),
  );
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.byteLength, 0);

  return Buffer.concat([Buffer.from([0x11, 0x10, 0x11, 0x00]), size, payload]);
}

function rawDataToBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }

  return Buffer.from(data);
}
