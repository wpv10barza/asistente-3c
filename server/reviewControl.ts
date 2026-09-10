export const REVIEWABLE_COLUMNS = ["B", "C", "H", "I", "J", "K", "L", "M", "N", "O"] as const;

export type ReviewableColumn = (typeof REVIEWABLE_COLUMNS)[number];
export type ReviewStatus = "proposed" | "approved" | "rejected";

export type ReviewOperation = {
  campo: string;
  columna_actualizar: string;
  encabezado: string;
  valor_actualizar: string | number;
  razon?: string;
};

export type ReviewProposal = {
  id: string;
  row: number;
  matched: string;
  operations: ReviewOperation[];
  externalCommandId?: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function assertSafeRow(row: number) {
  if (!Number.isInteger(row) || row < 1) throw new Error("La fila propuesta no es válida.");
}

function assertAllowedOperations(operations: ReviewOperation[]) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("La propuesta debe contener al menos una operación.");
  }
  for (const operation of operations) {
    if (!REVIEWABLE_COLUMNS.includes(operation.columna_actualizar as ReviewableColumn)) {
      throw new Error(`Columna bloqueada: ${operation.columna_actualizar}.`);
    }
    if (!String(operation.encabezado || "").trim()) {
      throw new Error("Toda operación debe incluir su encabezado auditado.");
    }
  }
}

export class AnalyticalReviewStore {
  private readonly proposals = new Map<string, ReviewProposal>();
  private readonly rowLocks = new Map<number, string>();
  private readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  propose(input: Omit<ReviewProposal, "id" | "status" | "createdAt" | "updatedAt" | "expiresAt">) {
    assertSafeRow(input.row);
    assertAllowedOperations(input.operations);

    const existingId = this.rowLocks.get(input.row);
    if (existingId) {
      const existing = this.proposals.get(existingId);
      if (existing && existing.status === "proposed" && !this.isExpired(existing)) {
        throw new Error(`La fila ${input.row} ya está bloqueada por otra propuesta.`);
      }
      this.release(input.row, existingId);
    }

    const now = new Date().toISOString();
    const proposal: ReviewProposal = {
      ...input,
      id: crypto.randomUUID(),
      status: "proposed",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
    };
    this.proposals.set(proposal.id, proposal);
    this.rowLocks.set(proposal.row, proposal.id);
    return proposal;
  }

  get(id: string) {
    const proposal = this.proposals.get(id);
    if (!proposal) throw new Error("Propuesta no encontrada.");
    if (proposal.status === "proposed" && this.isExpired(proposal)) {
      this.reject(id);
      throw new Error("La propuesta expiró y la fila fue desbloqueada.");
    }
    return proposal;
  }

  approve(id: string) {
    const proposal = this.get(id);
    if (proposal.status !== "proposed") throw new Error(`La propuesta no está en estado proposed: ${proposal.status}.`);
    proposal.status = "approved";
    proposal.updatedAt = new Date().toISOString();
    this.release(proposal.row, proposal.id);
    return proposal;
  }

  reject(id: string) {
    const proposal = this.proposals.get(id);
    if (!proposal) throw new Error("Propuesta no encontrada.");
    if (proposal.status === "proposed") {
      proposal.status = "rejected";
      proposal.updatedAt = new Date().toISOString();
    }
    this.release(proposal.row, proposal.id);
    return proposal;
  }

  private isExpired(proposal: ReviewProposal) {
    return Date.now() >= Date.parse(proposal.expiresAt);
  }

  private release(row: number, proposalId: string) {
    if (this.rowLocks.get(row) === proposalId) this.rowLocks.delete(row);
  }
}
