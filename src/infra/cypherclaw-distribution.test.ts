import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { withTestDir } from "../test-helpers/temp-dir.js";
import { applyCypherClawDistributionEnvironment } from "./cypherclaw-distribution.js";

it("projects persistent defaults without writing profile files before admission", async () => {
  await withTestDir({ prefix: "cypherclaw-bootstrap-" }, async (home) => {
    const root = path.join(home, "package");
    const relaySource = path.join(root, "cypher", "config", "browser-relay", "common-mine.json");
    await fs.mkdir(path.dirname(relaySource), { recursive: true });
    await fs.writeFile(relaySource, '{"socketPath":"auto"}\n');
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "openclaw",
        openclaw: {
          distribution: {
            id: "cypherclaw",
            repository: "CypherTroopers/cypherclaw",
            channel: "stable",
            sourceBranch: "cypherclaw-stable",
            sourceCommit: "a".repeat(40),
            releaseTag: "cypherclaw-v2026.9.9-aaaaaaaaaaaa",
          },
        },
      }),
    );
    const env: NodeJS.ProcessEnv = { HOME: home, OPENCLAW_PROFILE: "cypherclaw" };
    await applyCypherClawDistributionEnvironment(root, env);
    const state = path.join(home, ".openclaw-cypherclaw");
    expect(env.CYPHER_DATADIR).toBe(path.join(state, "cypher", "chaindbname"));
    expect(env.OPENCLAW_NO_AUTO_UPDATE).toBe("1");
    const relay = path.join(state, "cypher", "browser-relay", "common-mine.json");
    expect(env.CYPHER_BROWSER_RELAY_CONFIG).toBe(relay);
    expect(await fs.readdir(home)).toEqual(["package"]);
    await fs.mkdir(path.dirname(relay), { recursive: true });
    await fs.writeFile(relay, "operator configuration\n");
    const next: NodeJS.ProcessEnv = {
      HOME: home,
      OPENCLAW_PROFILE: "cypherclaw",
      CYPHER_DATADIR: path.join(home, "existing-chain"),
    };
    await applyCypherClawDistributionEnvironment(root, next);
    expect(next.CYPHER_DATADIR).toBe(path.join(home, "existing-chain"));
    expect(await fs.readFile(relay, "utf8")).toBe("operator configuration\n");
    const custom: NodeJS.ProcessEnv = {
      ...next,
      CYPHER_BROWSER_RELAY_CONFIG: path.join(home, "custom-relay.json"),
    };
    await applyCypherClawDistributionEnvironment(root, custom);
    expect(custom.CYPHER_BROWSER_RELAY_CONFIG).toBe(path.join(home, "custom-relay.json"));
    const externalRoot: NodeJS.ProcessEnv = {
      HOME: home,
      CYPHER_ROOT: path.join(home, "operator-node"),
    };
    await applyCypherClawDistributionEnvironment(root, externalRoot);
    expect(externalRoot.CYPHER_ROOT).toBe(path.join(home, "operator-node"));
    expect(externalRoot.CYPHER_DATADIR).toBeUndefined();
    expect(externalRoot.CYPHER_BROWSER_RELAY_CONFIG).toBeUndefined();
  });
});

it("leaves an ordinary source package's state and environment unchanged", async () => {
  await withTestDir({ prefix: "openclaw-source-bootstrap-" }, async (root) => {
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "openclaw" }));
    const env: NodeJS.ProcessEnv = { HOME: root, OPENCLAW_PROFILE: "cypherclaw" };
    await applyCypherClawDistributionEnvironment(root, env);
    expect(env).toEqual({ HOME: root, OPENCLAW_PROFILE: "cypherclaw" });
    expect(await fs.readdir(root)).toEqual(["package.json"]);
  });
});
