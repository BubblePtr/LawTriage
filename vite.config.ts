import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { agentApiPlugin } from "./server/agentApi";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), agentApiPlugin(env)],
  };
});
