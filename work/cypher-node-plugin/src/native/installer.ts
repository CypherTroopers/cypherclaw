import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { downloadArtifact } from "./download.js";
import {
  NODE_ARTIFACTS,
  NODE_PIN,
  resolveNativeTarget,
  WALLET_ARTIFACTS,
  WALLET_PIN,
} from "./pins.js";
import {
  NativeSetupError,
  type NativeArtifact,
  type NativePin,
  type NativeSetupAuthority,
  type NativeSetupProgress,
  type NativeSetupStatus,
} from "./types.js";

type Component = "node" | "wallet";
type StaticAsset = { source: string; destination: string; executable?: boolean };

function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** Owns immutable runtime installations, independently of chain and wallet data. */
export class NativeInstaller {
  readonly nodeRoot: string;
  readonly walletRoot: string;
  readonly #packageRoot: string;
  readonly #nativeDir: string;
  readonly #target;
  readonly #windows: boolean;
  readonly #lifetime = new AbortController();
  #initial: Promise<void> | undefined;
  #active: Promise<NativeSetupStatus> | undefined;
  #nodeReady = false;
  #walletReady = false;
  #progress: NativeSetupProgress | null = null;
  #error: NativeSetupStatus["error"] = null;

  constructor(options: {
    packageRoot: string;
    stateDir: string;
    platform?: string;
    arch?: string;
  }) {
    this.#packageRoot = path.resolve(options.packageRoot);
    this.#nativeDir = path.resolve(options.stateDir, "native");
    this.nodeRoot = path.join(this.#nativeDir, `cypher-${NODE_PIN.distributionCommit}`);
    this.walletRoot = path.join(this.#nativeDir, `wallet-${WALLET_PIN.distributionCommit}`);
    const platform = options.platform ?? process.platform;
    this.#windows = platform === "win32";
    this.#target = resolveNativeTarget(platform, options.arch ?? process.arch);
  }

  #artifacts(component: Component): readonly NativeArtifact[] {
    if (!this.#target) return [];
    return (
      (component === "node" ? NODE_ARTIFACTS[this.#target] : WALLET_ARTIFACTS[this.#target]) ?? []
    );
  }

  #assets(component: Component): StaticAsset[] {
    const asset = (source: string, destination = source, executable = false): StaticAsset => ({
      source: path.join(this.#packageRoot, "assets", source),
      destination,
      executable,
    });
    if (component === "wallet") {
      return [
        asset(
          `native/wallet-build-info/${this.#target}.json`,
          `bin/${this.#target}/build-info.json`,
        ),
        ...["LICENSE", "THIRD_PARTY_NOTICES.md", "third-party-licenses"].map((name) =>
          asset(`wallet-generator/${name}`, name),
        ),
      ];
    }
    const launcher =
      this.#target === "windows-amd64"
        ? "colossusX_windows.ps1"
        : this.#target === "darwin-arm64"
          ? "colossusX_mac.sh"
          : "colossusX_linux.sh";
    return [
      asset(`cypher/${launcher}`, launcher, !this.#windows),
      asset("cypher/genesis.json", "genesis.json"),
      asset(
        "cypher/config/browser-relay/common-mine.json",
        "config/browser-relay/common-mine.json",
      ),
      asset("cypher/licenses", "licenses"),
      ...(!this.#windows ? [asset("native/browser-relay.sh", "build/browser-relay.sh")] : []),
    ];
  }

  async #inspect(component: Component): Promise<boolean> {
    const artifacts = this.#artifacts(component);
    if (artifacts.length === 0) return false;
    const root = component === "node" ? this.nodeRoot : this.walletRoot;
    try {
      const directory = await fs.lstat(root);
      if (!directory.isDirectory()) return false;
      for (const artifact of artifacts) {
        const destination = path.join(root, artifact.path);
        const stat = await fs.lstat(destination);
        if (
          !stat.isFile() ||
          stat.size !== artifact.bytes ||
          (artifact.executable && !this.#windows && (stat.mode & 0o111) === 0)
        )
          return false;
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(destination)) hash.update(chunk);
        if (hash.digest("hex") !== artifact.sha256) return false;
      }
      for (const asset of this.#assets(component)) {
        const destination = path.join(root, asset.destination);
        const stat = await fs.lstat(destination);
        const sourceStat = await fs.lstat(asset.source);
        if (sourceStat.isDirectory()) {
          if (!stat.isDirectory()) return false;
        } else {
          if (!stat.isFile() || (asset.executable && (stat.mode & 0o111) === 0)) return false;
          const [expected, installed] = await Promise.all([
            fs.readFile(asset.source),
            fs.readFile(destination),
          ]);
          if (!expected.equals(installed)) return false;
        }
      }
      return true;
    } catch (error) {
      if (missing(error)) return false;
      throw new NativeSetupError("filesystem");
    }
  }

  async #load(): Promise<void> {
    await (this.#initial ??= (async () => {
      this.#nodeReady = await this.#inspect("node");
      this.#walletReady = await this.#inspect("wallet");
    })());
  }

  #snapshot(preparing = this.#active !== undefined): NativeSetupStatus {
    const nodeSupported = this.#artifacts("node").length > 0;
    const walletSupported = this.#artifacts("wallet").length > 0;
    const ready =
      (nodeSupported || walletSupported) &&
      (!nodeSupported || this.#nodeReady) &&
      (!walletSupported || this.#walletReady);
    return {
      state: preparing
        ? "preparing"
        : this.#error
          ? "error"
          : ready
            ? "ready"
            : !nodeSupported && !walletSupported
              ? "unsupported"
              : "missing",
      target: this.#target,
      node: { supported: nodeSupported, ready: this.#nodeReady, pin: { ...NODE_PIN } },
      wallet: { supported: walletSupported, ready: this.#walletReady, pin: { ...WALLET_PIN } },
      progress: this.#progress ? { ...this.#progress } : null,
      error: this.#error ? { ...this.#error } : null,
    };
  }

  async status(): Promise<NativeSetupStatus> {
    try {
      await this.#load();
    } catch {
      const error = new NativeSetupError("filesystem");
      this.#error = { code: error.code, message: error.message };
    }
    return this.#snapshot();
  }

  #assert(authority: NativeSetupAuthority): void {
    if (this.#lifetime.signal.aborted) throw new NativeSetupError("closed");
    try {
      authority.signal?.throwIfAborted();
      authority.assertCurrent();
    } catch {
      throw new NativeSetupError("authority");
    }
  }

  prepare(authority: NativeSetupAuthority): Promise<NativeSetupStatus> {
    this.#assert(authority);
    if (this.#active) {
      return this.#active.then((status) => {
        this.#assert(authority);
        return status;
      });
    }
    const operation = this.#prepare(authority);
    this.#active = operation;
    void operation.then(
      () => {
        this.#active = undefined;
      },
      () => {
        this.#active = undefined;
      },
    );
    return operation;
  }

  async #prepare(authority: NativeSetupAuthority): Promise<NativeSetupStatus> {
    this.#error = null;
    const signal = AbortSignal.any([
      this.#lifetime.signal,
      ...(authority.signal ? [authority.signal] : []),
    ]);
    const assertCurrent = () => this.#assert(authority);
    try {
      const admitted = this.#initial !== undefined;
      await this.#load();
      assertCurrent();
      if (!this.#target) throw new NativeSetupError("unsupported");
      // Status reuses admission facts. An explicit setup request also repairs
      // files changed or removed while this Gateway owner remains running.
      if (admitted) {
        this.#nodeReady = await this.#inspect("node");
        this.#walletReady = await this.#inspect("wallet");
        assertCurrent();
      }
      const components: Component[] = [];
      if (!this.#nodeReady && this.#artifacts("node").length) components.push("node");
      if (!this.#walletReady) components.push("wallet");
      const totalFiles = components.reduce(
        (total, component) => total + this.#artifacts(component).length,
        0,
      );
      let completedFiles = 0;
      for (const component of components) {
        await this.#install(
          component,
          signal,
          assertCurrent,
          (artifact, downloadedBytes) => {
            this.#progress = {
              file: artifact.path,
              downloadedBytes,
              totalBytes: artifact.bytes,
              completedFiles,
              totalFiles,
            };
          },
          () => {
            completedFiles++;
            if (this.#progress) this.#progress.completedFiles = completedFiles;
          },
        );
        if (component === "node") this.#nodeReady = true;
        else this.#walletReady = true;
      }
      assertCurrent();
      this.#progress = null;
      return this.#snapshot(false);
    } catch (cause) {
      const error = cause instanceof NativeSetupError ? cause : new NativeSetupError("filesystem");
      this.#error = { code: error.code, message: error.message };
      this.#progress = null;
      // A transient admission read failure must be retryable without restarting the Gateway.
      this.#initial = undefined;
      throw error;
    }
  }

  async #install(
    component: Component,
    signal: AbortSignal,
    assertCurrent: () => void,
    progress: (artifact: NativeArtifact, bytes: number) => void,
    completed: () => void,
  ): Promise<void> {
    const pin: NativePin = component === "node" ? NODE_PIN : WALLET_PIN;
    const root = component === "node" ? this.nodeRoot : this.walletRoot;
    const stage = path.join(this.#nativeDir, `.${component}-${randomUUID()}`);
    const retained = `${root}.retained-${randomUUID()}`;
    let movedPrevious = false;
    let installed = false;
    try {
      assertCurrent();
      await fs.mkdir(stage, { recursive: true, mode: 0o700 });
      for (const asset of this.#assets(component)) {
        const destination = path.join(stage, asset.destination);
        assertCurrent();
        await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        assertCurrent();
        await fs.cp(asset.source, destination, {
          recursive: true,
          dereference: false,
          errorOnExist: true,
          force: false,
        });
        if (asset.executable && !this.#windows) {
          assertCurrent();
          await fs.chmod(destination, 0o700);
        }
      }
      for (const artifact of this.#artifacts(component)) {
        const destination = path.join(stage, artifact.path);
        assertCurrent();
        await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        progress(artifact, 0);
        await downloadArtifact({
          pin,
          artifact,
          destination,
          signal,
          assertCurrent,
          onProgress: (bytes) => progress(artifact, bytes),
        });
        if (artifact.executable && !this.#windows) {
          assertCurrent();
          await fs.chmod(destination, 0o700);
        }
        completed();
      }
      assertCurrent();
      try {
        await fs.rename(root, retained);
        movedPrevious = true;
      } catch (error) {
        if (!missing(error)) throw error;
      }
      assertCurrent();
      await fs.rename(stage, root);
      installed = true;
    } finally {
      // Cleanup and rollback belong to the accepted operation even after caller revocation.
      if (movedPrevious && !installed) await fs.rename(retained, root);
      await fs.rm(stage, { recursive: true, force: true });
    }
  }

  async close(): Promise<void> {
    this.#lifetime.abort();
    await this.#active?.catch(() => {});
  }
}
