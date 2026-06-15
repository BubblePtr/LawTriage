#!/usr/bin/env bun
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export type DevLiveKitProcessName = "web" | "agent";

export type DevLiveKitProcessSpec = {
  name: DevLiveKitProcessName;
  command: string;
  args: string[];
};

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export function createDevLiveKitProcessSpecs(viteArgs: readonly string[] = []): DevLiveKitProcessSpec[] {
  return [
    {
      name: "web",
      command: "bun",
      args: ["run", "dev", ...(viteArgs.length > 0 ? ["--", ...viteArgs] : [])],
    },
    {
      name: "agent",
      command: "bun",
      args: ["run", "agent:dev"],
    },
  ];
}

export function getChildExitCode(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) {
    return code;
  }
  return signal ? 1 : 0;
}

function formatProcessCommand(spec: DevLiveKitProcessSpec): string {
  return [spec.command, ...spec.args].join(" ");
}

function formatChildExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (code !== null) {
    return `with code ${code}`;
  }
  return signal ? `from ${signal}` : "without an exit code";
}

function isRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null && !child.killed;
}

export function runDevLiveKit(viteArgs: readonly string[] = process.argv.slice(2)): void {
  const specs = createDevLiveKitProcessSpecs(viteArgs);
  const children = new Map<DevLiveKitProcessName, ChildProcess>();
  let stopping = false;

  const stopChildren = (except?: ChildProcess, signal: NodeJS.Signals = "SIGTERM") => {
    for (const child of children.values()) {
      if (child !== except && isRunning(child)) {
        child.kill(signal);
      }
    }
  };

  for (const spec of specs) {
    console.info(`[dev:livekit] starting ${spec.name}: ${formatProcessCommand(spec)}`);
    const child = spawn(spec.command, spec.args, {
      env: process.env,
      stdio: "inherit",
    });
    children.set(spec.name, child);

    child.once("error", (error) => {
      if (stopping) {
        return;
      }
      stopping = true;
      process.exitCode = 1;
      console.error(`[dev:livekit] failed to start ${spec.name}: ${error.message}`);
      stopChildren(child);
    });

    child.once("exit", (code, signal) => {
      if (stopping) {
        return;
      }
      stopping = true;
      process.exitCode = getChildExitCode(code, signal);
      console.error(
        `[dev:livekit] ${spec.name} exited ${formatChildExit(code, signal)}; stopping the other process.`,
      );
      stopChildren(child);
    });
  }

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      if (stopping) {
        process.exit(1);
      }
      stopping = true;
      process.exitCode = 0;
      console.info(`[dev:livekit] received ${signal}; stopping child processes.`);
      stopChildren(undefined, signal);
    });
  }
}

function isEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint) && import.meta.url === pathToFileURL(resolve(entrypoint)).href;
}

if (isEntrypoint()) {
  runDevLiveKit();
}
