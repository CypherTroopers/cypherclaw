import { describe, expect, it, vi } from "vitest";
import { createRequestAuthority } from "./authority.js";

function fixture(scope = "operator.admin") {
  const connection = new AbortController();
  const request = new AbortController();
  const service = new AbortController();
  const options: Parameters<typeof createRequestAuthority>[0] = {
    client: {
      connect: {
        minProtocol: 1,
        maxProtocol: 1,
        client: { id: "openclaw-control-ui", version: "test", platform: "test", mode: "ui" },
        role: "operator",
        scopes: [scope],
      },
      connectionSignal: connection.signal,
    },
    signal: request.signal,
    hasCurrentClientAuthority: () => true,
    sessionMutationCommitGuard: vi.fn(),
  };
  return { options, connection, request, service };
}

describe("Cypher plugin request authority", () => {
  it("cancels active work when the Gateway request entry closes", () => {
    const { options, service } = fixture();
    const gateway = new AbortController();
    const authority = createRequestAuthority(
      options,
      service.signal,
      "operator.admin",
      gateway.signal,
    );
    authority.assertCurrent();
    gateway.abort();
    expect(authority.signal.aborted).toBe(true);
    expect(authority.assertCurrent).toThrow("no longer authorized");
  });

  it("requires the live host authority and current admin grant for mutations", () => {
    const { options, service } = fixture("operator.read");
    expect(() =>
      createRequestAuthority(options, service.signal, "operator.read").assertCurrent(),
    ).not.toThrow();
    const authority = createRequestAuthority(options, service.signal, "operator.admin");
    expect(authority.assertCurrent).toThrow("no longer authorized");
    options.client!.connect.scopes = ["operator.admin"];
    expect(authority.assertCurrent).not.toThrow();
    options.hasCurrentClientAuthority = () => false;
    expect(authority.assertCurrent).toThrow("no longer authorized");
  });

  it.each(["connection", "request", "service"] as const)(
    "cancels native work when the %s closes",
    (source) => {
      const state = fixture();
      const authority = createRequestAuthority(
        state.options,
        state.service.signal,
        "operator.admin",
      );
      authority.assertCurrent();
      state[source].abort();
      expect(authority.signal.aborted).toBe(true);
      expect(authority.assertCurrent).toThrow("no longer authorized");
    },
  );

  it("rechecks invalidation and the host's commit guard at the effect boundary", () => {
    const { options, service } = fixture();
    const authority = createRequestAuthority(options, service.signal, "operator.admin");
    authority.assertCurrent();
    expect(options.sessionMutationCommitGuard).toHaveBeenCalledOnce();
    options.client!.invalidated = true;
    expect(authority.assertCurrent).toThrow("no longer authorized");
  });

  it.each(["connectionSignal", "hasCurrentClientAuthority"] as const)(
    "fails clearly when an older host omits %s",
    (missing) => {
      const { options, service } = fixture();
      if (missing === "connectionSignal") {
        delete options.client!.connectionSignal;
      } else {
        delete options.hasCurrentClientAuthority;
      }
      expect(() =>
        createRequestAuthority(options, service.signal, "operator.admin").assertCurrent(),
      ).toThrow("Update OpenClaw");
    },
  );
});
