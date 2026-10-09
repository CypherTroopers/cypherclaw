export type CypherClawDistribution = {
  id: "cypherclaw";
  repository: "CypherTroopers/cypherclaw";
  channel: "stable";
  sourceBranch: "cypherclaw-stable";
  sourceCommit: string;
  releaseTag: string;
};
export type CypherClawArtifact = { file: string; sha256: string; bytes: number };
export type CypherClawReleaseManifest = Omit<CypherClawDistribution, "id"> & {
  schemaVersion: 1;
  version: string;
  nodeVersion: "24.21.0";
  package: CypherClawArtifact & {
    name: "openclaw";
    nodeEngine: string;
    schemaVersions: { state: number; agent: number };
  };
  assets: CypherClawArtifact[];
  supportedTargets: string[];
  publication: { ready: boolean; limitations: string[] };
};
export const CYPHERCLAW_REPOSITORY: "CypherTroopers/cypherclaw";
export const CYPHERCLAW_SOURCE_BRANCH: "cypherclaw-stable";
export const CYPHERCLAW_NODE_VERSION: "24.21.0";
export const CYPHERCLAW_INSTALL_ASSETS: readonly string[];
export const CYPHERCLAW_TARGETS: readonly string[];
export function parseCypherClawDistribution(value: unknown): CypherClawDistribution | null;
export function validateCypherClawReleaseManifest(value: unknown): CypherClawReleaseManifest;
export function parseChecksumFile(content: string): Map<string, string>;
export function hashFile(file: string): Promise<{ sha256: string; bytes: number }>;
export function verifyAsset(file: string, expected: CypherClawArtifact): Promise<void>;
