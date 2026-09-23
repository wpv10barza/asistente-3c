import assert from "node:assert/strict";
import test from "node:test";
import { registerVisionCapture } from "../server/visionReadNumber.js";

test("vision capture stores a short-lived capture id", () => {
  const result = registerVisionCapture({
    base64: Buffer.from("vision-test").toString("base64"),
    mimeType: "image/jpeg",
    localOcrText: "12.50 kg",
  });

  assert.match(result.capture_id, /^vision-/);
  assert.equal(result.expires_in_ms, 60_000);
});

test("vision capture rejects malformed base64", () => {
  assert.throws(
    () =>
      registerVisionCapture({
        base64: "not base64 ???",
      }),
    /Base64 válido/,
  );
});
