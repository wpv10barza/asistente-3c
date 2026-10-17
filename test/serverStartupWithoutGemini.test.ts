import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const serverScript = "server.ts";

test("el backend puede arrancar sin GEMINI_API_KEY para habilitar el Device API", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", serverScript], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "0",
      GEMINI_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let settled = false;

  const cleanup = () => {
    if (!child.killed) child.kill("SIGTERM");
  };

  try {
    const result = await new Promise<{ code: number | null }>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`El backend no confirmó arranque a tiempo. stderr=${stderr}`));
      }, 15_000);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        if (stdout.includes("Server running on http://0.0.0.0:0")) {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            resolve({ code: null });
            cleanup();
          }
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.on("exit", (code) => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        resolve({ code });
      });
    });

    assert.equal(result.code, null);
    assert.match(stdout, /Server running on http:\/\/0\.0\.0\.0:0/);
    assert.doesNotMatch(stdout, /GEMINI_API_KEY no esta configurada/);
    assert.doesNotMatch(stderr, /Error|TypeError|Unhandled/i);
  } finally {
    cleanup();
  }
});
