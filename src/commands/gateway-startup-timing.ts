// Service activation precedes cold-start loading and the authenticated handshake.
// Cold starts on slower hosts can take over a minute before the Gateway is ready.
// All managed setup observers share this startup allowance.
export function resolveGatewayStartupTiming() {
  const windows = process.platform === "win32";
  return {
    deadlineMs: 120_000,
    probeTimeoutMs: windows ? 15_000 : 10_000,
  };
}
