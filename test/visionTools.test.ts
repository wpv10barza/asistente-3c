import test from "node:test";
import assert from "node:assert/strict";

import {
  executeVisionReadNumber,
  saveVisionFrame,
  VISION_READ_NUMBER_FUNCTION,
} from "../server/visionTools.js";

test("vision_read_number is declared as a real callable tool", () => {
  assert.equal(VISION_READ_NUMBER_FUNCTION.name, "vision_read_number");
  assert.ok(VISION_READ_NUMBER_FUNCTION.parameters);
  assert.ok(
    VISION_READ_NUMBER_FUNCTION.parameters.required?.includes(
      "vision_session_id"
    )
  );
});

test("expired or unknown sessions never produce a guessed number", async () => {
  const result = await executeVisionReadNumber("vision-does-not-exist");

  assert.equal(result.status, "not_readable");
  assert.equal(result.number_text, "");
  assert.equal(result.value, null);
});

test("a frame receives a temporary session id", () => {
  const id = saveVisionFrame({
    imageBase64: "dGVzdA==",
    mimeType: "image/jpeg",
    unit: "kg",
  });

  assert.match(id, /^vision-/);
});
