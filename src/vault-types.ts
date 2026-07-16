export type VaultProviderKind = "git" | "folder" | "mcp";

export interface VaultConnection {
  name: string;
  provider: VaultProviderKind;
  location: string;
  connectedAt: string;
  revision?: string;
}

export interface VaultConnections { vaults: Record<string, VaultConnection> }

export interface VaultPolicy {
  reviewers: Array<{ id: string; publicKey: string }>;
  approvalsRequired: number;
  blockSeverities: Array<"high" | "critical">;
  preventSelfApproval: boolean;
}

export interface VaultManifest {
  schemaVersion: 1;
  name: string;
  policy: VaultPolicy;
}

export interface VaultLockAsset {
  name: string;
  version: string;
  type: "skill" | "rule" | "command" | "prompt" | "agent";
  digest: string;
  publisher: string;
  publishedAt: string;
  auditRisk: string;
}

export interface VaultLock {
  schemaVersion: 1;
  revision: number;
  assets: Record<string, VaultLockAsset>;
}

export interface VaultApproval {
  schemaVersion: 1;
  asset: string;
  digest: string;
  reviewer: string;
  approvedAt: string;
  signature: string;
}

export interface VaultProvider {
  readonly kind: VaultProviderKind;
  prepare(connection: VaultConnection): Promise<string>;
  publish(connection: VaultConnection, localRoot: string, expectedRevision: number): Promise<void>;
}
