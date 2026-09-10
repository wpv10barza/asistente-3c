import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AnalyticalReviewStore } from "../server/reviewControl.js";

describe("AnalyticalReviewStore", () => {
  const operation = {
    campo: "frecuencia",
    columna_actualizar: "L",
    encabezado: "Frecuencia",
    valor_actualizar: 3,
  };

  it("stores a new proposal in proposed state and locks the row", () => {
    const store = new AnalyticalReviewStore(60_000);
    const proposal = store.propose({ row: 12, matched: "Inspección J10", operations: [operation] });

    assert.equal(proposal.status, "proposed");
    assert.equal(store.get(proposal.id).row, 12);
    assert.throws(
      () => store.propose({ row: 12, matched: "Otra tarea", operations: [operation] }),
      /ya está bloqueada/
    );
  });

  it("rejects writes to columns outside the whitelist", () => {
    const store = new AnalyticalReviewStore();
    assert.throws(
      () => store.propose({
        row: 12,
        matched: "Inspección J10",
        operations: [{ ...operation, columna_actualizar: "A" }],
      }),
      /Columna bloqueada: A/
    );
  });

  it("releases the row when approved", () => {
    const store = new AnalyticalReviewStore();
    const first = store.propose({ row: 20, matched: "Tarea A", operations: [operation] });
    assert.equal(store.approve(first.id).status, "approved");

    const second = store.propose({ row: 20, matched: "Tarea B", operations: [operation] });
    assert.equal(second.status, "proposed");
  });

  it("expires a proposal and unlocks the row", async () => {
    const store = new AnalyticalReviewStore(1);
    const proposal = store.propose({ row: 25, matched: "Tarea", operations: [operation] });
    await new Promise(resolve => setTimeout(resolve, 5));

    assert.throws(() => store.get(proposal.id), /expiró/);
    const next = store.propose({ row: 25, matched: "Tarea nueva", operations: [operation] });
    assert.equal(next.status, "proposed");
  });
});
