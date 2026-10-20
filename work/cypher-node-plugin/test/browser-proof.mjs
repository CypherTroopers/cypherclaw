import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const phase = process.argv[2] ?? "after";
assert(["before", "after"].includes(phase));
const parent = path.join(root, "artifacts/proof");
await fs.mkdir(parent, { recursive: true });
const proof = await fs.mkdtemp(path.join(parent, `${phase}-`));
let js;
let css;
if (phase === "before") {
  const original = path.resolve(root, "../../cypher-plugin");
  const bundle = await build({
    absWorkingDir: original,
    entryPoints: ["browser/index.ts"],
    bundle: true,
    write: false,
    outfile: "before.js",
    platform: "browser",
    format: "esm",
    target: "es2022",
    nodePaths: [path.join(root, "node_modules")],
    tsconfig: path.join(original, "tsconfig.json"),
  });
  js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).contents;
  css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.contents ?? Buffer.alloc(0);
  await fs.writeFile(path.join(proof, "before.js"), js);
  await fs.writeFile(path.join(proof, "before.css"), css);
} else {
  const manifest = JSON.parse(await fs.readFile(path.join(root, "openclaw.plugin.json"), "utf8"));
  js = await fs.readFile(path.join(root, manifest.controlUi.entry));
  css = Buffer.concat(
    await Promise.all(
      (manifest.controlUi.styles ?? []).map((name) => fs.readFile(path.join(root, name))),
    ),
  );
}
const host = await fs.readFile(path.join(root, "test/browser-host.mjs"));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cypher plugin public host proof</title><style>
:root{color-scheme:dark;--bg:#0e1015;--card:#171a21;--bg-elevated:#1c1f26;--bg-hover:#252a33;--text:#e8eaf0;--text-strong:#f1f3f9;--muted:#8b909b;--muted-strong:#a2a8b4;--border:#292e38;--border-strong:#454b58;--accent:#ff4d5a;--primary:#ff4d5a;--primary-foreground:white;--ok:#23cf73;--danger:#ff4d5a;--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:20px;--space-8:32px;--radius-md:8px;--radius-lg:14px;--control-ui-text-xs:11px;--control-ui-text-sm:12px;--control-ui-text-md:14px;--control-ui-text-2xl:24px;--font-body:Arial,sans-serif;--mono:monospace}body{margin:0;background:var(--bg);color:var(--text)}main{width:100%;min-width:0;padding-block:20px}button,input,select{font:inherit}a{color:inherit}
</style><link rel="stylesheet" href="/plugin.css"><main></main><script type="module" src="/host.js"></script></html>`;
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const content =
    pathname === "/plugin.js"
      ? ["text/javascript", js]
      : pathname === "/host.js"
        ? ["text/javascript", host]
        : pathname === "/plugin.css"
          ? ["text/css", css]
          : ["text/html", html];
  response.writeHead(200, { "content-type": content[0], "cache-control": "no-store" });
  response.end(content[1]);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const report = {
  phase,
  proof,
  bundleSha256: createHash("sha256").update(js).digest("hex"),
  jsBytes: js.length,
  cssBytes: css.length,
  checks: [],
  screenshots: [],
  pageErrors: [],
};
const signer = `0x${"1".repeat(40)}`;
const second = `0x${"2".repeat(40)}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-partial-raster", "--disable-gpu-rasterization"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1400 },
    reducedMotion: "reduce",
    locale: "en-US",
    colorScheme: "dark",
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error)));
  const check = (text) => report.checks.push(text);
  const requestCount = (method) =>
    page.evaluate(
      (name) => window.fixture.requests.filter((row) => row.method === name).length,
      method,
    );
  const waitRequest = (method) =>
    page.waitForFunction(
      (name) => window.fixture?.requests.some((row) => row.method === name),
      method,
    );
  const capture = async (name) => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(proof, `${name}.png`), animations: "disabled" });
    report.screenshots.push(`${name}.png`);
  };
  const go = async (scenario = "ready", locale = "en") => {
    await page.goto(`${base}/?scenario=${scenario}&locale=${locale}`);
    await page.locator(".cypher-plugin .settings-page").waitFor();
    if (scenario !== "offline") {
      await waitRequest("cypher.status");
    }
    await page.locator(".cypher-plugin-wallet").waitFor({ state: "attached" });
    await waitRequest("cypher.wallet.generator.status");
  };
  const select = async (tab) => {
    await page.locator(`#cypher-tab-${tab}`).click();
    await page.locator(`#cypher-panel-${tab}`).waitFor({ state: "visible" });
    await page.waitForFunction(
      () => !document.querySelector('[data-cypher-action="refresh"]').disabled,
    );
    assert.equal(await page.locator('[role="tabpanel"]:visible').count(), 1);
  };
  if (phase === "before") {
    await go();
    report.originalTabCount = await page.locator('[role="tab"]').count();
    await capture("desktop-existing-plugin");
    await page.setViewportSize({ width: 390, height: 844 });
    await capture("mobile-existing-plugin");
    check(
      "Captured the original standalone public page; its missing tab strip is the pre-port control.",
    );
  } else {
    await go();
    await waitRequest("cypher.wallets.list");
    assert.deepEqual(
      (await page.locator('[role="tab"]').allTextContents()).map((text) => text.trim()),
      ["Overview", "Node", "Wallets", "Send", "Mining", "Explorer"],
    );
    assert.equal(await requestCount("cypher.setup.prepare"), 0);
    const image = page.locator(".cypher-brand-mark");
    assert.match(await image.getAttribute("src"), /^data:image\/png;base64,/);
    for (const tab of ["overview", "node", "wallets", "send", "mining", "explorer"]) {
      await select(tab);
      await capture(`desktop-${tab}`);
    }
    check(
      "Real built plugin registers all six public-host tabs, displays embedded custom artwork, and never prepares on mount.",
    );
    await select("wallets");
    await page.locator("#cypher-wallet").selectOption(second);
    await page.locator('[data-cypher-action="lock"]').click();
    await waitRequest("cypher.accounts.lock");
    assert.deepEqual(
      await page.evaluate(
        () => window.fixture.requests.find((row) => row.method === "cypher.accounts.lock").params,
      ),
      { address: second },
    );
    assert.equal(await requestCount("cypher.accounts.select"), 0);
    await page.locator("#cypher-panel-wallets summary").click();
    await page.locator('[data-wallet-action="generate"]').click();
    await page.locator('[data-wallet-value="address"]').waitFor();
    assert.equal(
      await page.locator('[data-wallet-value="privateKey"]').innerText(),
      "••••••••••••••••••••••••",
    );
    assert.equal(await page.locator('[data-wallet-action="generate"]').isDisabled(), true);
    await capture("desktop-wallet-generator");
    await page.locator('[data-wallet-action="clear"]').click();
    await page.locator('[data-wallet-value="address"]').waitFor({ state: "detached" });
    check(
      "Wallet actions retain the selected wallet without selecting a signer; independent generator masks, guards and clears its result.",
    );
    await select("send");
    await page.locator("#cypher-send-wallet").selectOption(second);
    await page.locator("#cypher-send-recipient").fill(signer);
    await page.locator("#cypher-send-amount").fill("0.000000000000000001");
    await page.locator('[data-cypher-action="prepare"]').click();
    await page.locator("#cypher-send-confirm").waitFor();
    assert.equal(await page.locator('[data-cypher-action="send"]').isDisabled(), true);
    await capture("desktop-send-review");
    await page.locator("#cypher-send-confirm").check();
    await page.locator("#cypher-send-password").fill("fixture-password");
    await page.locator('[data-cypher-action="send"]').click();
    await page.locator("#cypher-send-password").waitFor({ state: "detached" });
    await page.getByText("Included · awaiting finality", { exact: true }).waitFor();
    await page.evaluate(() => window.fixture.finality());
    await page.locator('[data-cypher-action="refresh"]').click();
    await page.getByText("Complete", { exact: true }).waitFor();
    assert.equal(await requestCount("cypher.transfers.send"), 1);
    check(
      "Transfer review blocks sending until explicit confirmation, submits once and waits for finality before Complete.",
    );
    await select("mining");
    await page.locator("#cypher-threads").fill("2");
    await page.locator("#cypher-mining-password").fill("fixture-password");
    await page.locator('[data-cypher-action="mining-start"]').click();
    await waitRequest("cypher.mining.start");
    await page.waitForFunction(
      () => !document.querySelector('[data-cypher-action="refresh"]').disabled,
    );
    assert.deepEqual(
      await page.evaluate(
        () => window.fixture.requests.find((row) => row.method === "cypher.mining.start").params,
      ),
      { threads: 2, signer, password: "fixture-password" },
    );
    assert.equal(await page.locator("#cypher-mining-password").inputValue(), "");
    await page.locator("#cypher-recipient").fill(second);
    await page.locator("#cypher-reward-password").fill("fixture-password");
    await page.locator('[data-cypher-action="reward-set"]').click();
    await waitRequest("cypher.reward.set");
    assert.deepEqual(
      await page.evaluate(
        () => window.fixture.requests.find((row) => row.method === "cypher.reward.set").params,
      ),
      { signer, recipient: second, password: "fixture-password" },
    );
    check(
      "Mining threads/signer A and reward recipient B remain separate, with immediate password clearing.",
    );
    await select("explorer");
    await page.locator("#cypher-explorer-query").fill(signer);
    assert.equal(
      await page.locator("#cypher-panel-explorer a").first().getAttribute("href"),
      `https://colossusx.make-cph-great-again.community/address/${signer}`,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    for (const tab of ["wallets", "mining"]) {
      await select(tab);
      await capture(`mobile-${tab}`);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
    }
    check(
      "Explorer preserves network-specific links; mobile Wallets and Mining have no document horizontal overflow.",
    );
    await page.setViewportSize({ width: 1440, height: 1400 });
    await go("missing", "ja");
    const prepare = page.locator('#cypher-panel-overview [data-cypher-action="setup-prepare"]');
    assert.equal(await requestCount("cypher.setup.prepare"), 0);
    assert.match(await prepare.innerText(), /ノードを準備/);
    await capture("setup-missing-japanese");
    await prepare.click();
    await waitRequest("cypher.setup.prepare");
    await page.locator('#cypher-panel-overview [data-cypher-action="setup-refresh"]').click();
    await page.getByText("1,048,576 / 2,097,152 B", { exact: true }).first().waitFor();
    assert.equal(await prepare.isDisabled(), true);
    await capture("setup-preparing-japanese");
    await page.evaluate(() => window.fixture.finishSetup(true));
    await page.waitForFunction(
      () =>
        !document.querySelector('#cypher-panel-overview [data-cypher-action="setup-prepare"]')
          .disabled,
    );
    await capture("setup-error-japanese");
    await prepare.click();
    await page.evaluate(() => window.fixture.finishSetup(false));
    await select("node");
    await page.waitForFunction(
      () => !document.querySelector('[data-cypher-action="start"]').disabled,
    );
    assert.equal(await requestCount("cypher.start"), 0);
    assert.match(
      await page.locator('#cypher-panel-node [data-cypher-action="setup-prepare"]').innerText(),
      /準備済みファイルを検証/,
    );
    assert.equal(
      await page.locator('#cypher-panel-node [data-cypher-action="setup-prepare"]').isDisabled(),
      false,
    );
    await capture("setup-ready-japanese");
    check(
      "Native setup is explicit, shows progress and safe failure, retries successfully, enables Start without starting automatically.",
    );
    for (const scenario of ["read-only", "unsupported", "wallet-only"]) {
      await go(scenario);
      await select("node");
      assert.equal(
        await page
          .locator('[data-cypher-action="setup-prepare"]')
          .filter({ visible: true })
          .isDisabled(),
        scenario !== "wallet-only",
      );
      if (scenario === "wallet-only") {
        assert.equal(await page.locator('[data-cypher-action="start"]').isDisabled(), true);
        await select("wallets");
        await page.locator("#cypher-panel-wallets summary").click();
        assert.equal(await page.locator('[data-wallet-action="generate"]').isDisabled(), false);
      }
      await capture(`state-${scenario}`);
      assert.equal(await requestCount("cypher.setup.prepare"), 0);
    }
    await go("wallet-only-missing");
    await select("node");
    const walletPrepare = page.locator('#cypher-panel-node [data-cypher-action="setup-prepare"]');
    assert.equal(await walletPrepare.isDisabled(), false);
    await walletPrepare.click();
    await waitRequest("cypher.setup.prepare");
    await page.evaluate(() => window.fixture.finishSetup(false));
    await select("wallets");
    await page.locator("#cypher-panel-wallets summary").click();
    await page.waitForFunction(
      () => !document.querySelector('[data-wallet-action="generate"]').disabled,
    );
    check(
      "Read-only/unsupported controls stay disabled; wallet-only platforms allow explicit preparation and independent generation without a node build.",
    );
  }
  assert.deepEqual(report.pageErrors, []);
  report.success = true;
} catch (error) {
  report.success = false;
  report.error = String(error);
  throw error;
} finally {
  await fs.writeFile(path.join(proof, "report.json"), JSON.stringify(report, null, 2));
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  console.log(JSON.stringify({ proof, success: report.success, checks: report.checks.length }));
}
