# Cypher for OpenClaw

An independent OpenClaw plugin that adds the Cypher management page to the
official Control UI. Each operator installs and runs the plugin on their own
OpenClaw Gateway. The browser displays the page; node processes and wallet
generation run on that operator's Gateway machine.

The plugin includes node start and graceful stop, local IPC connection,
status and logs, mining controls, account creation and selection, unlock and
lock, reward recipient registration, and independent wallet generation.
Wallet generation works without starting or connecting to a Cypher node.

## Compatibility

The development host is pinned to the official `openclaw@2026.9.8` npm release.
Installation requires OpenClaw 2026.9.8 or newer. Newer releases still require
compatibility checks; using the public plugin API removes the need to merge
OpenClaw source changes into this project, but does not guarantee compatibility
with every future API change. Native custom plugin UI is currently an
experimental OpenClaw feature and must be enabled explicitly.

| Gateway platform | Node management with bundled binary                | Wallet generation |
| ---------------- | -------------------------------------------------- | ----------------- |
| Linux x64        | Yes; glibc 2.38+ and libstdc++ with GLIBCXX_3.4.32 | Yes               |
| Linux ARM64      | No bundled node binary                             | Yes               |
| macOS ARM64      | Yes; macOS 15+                                     | Yes               |
| macOS x64        | No bundled node binary                             | Yes               |
| Windows x64      | Yes; PowerShell and OpenClaw's ConPTY support      | Yes               |
| Windows ARM64    | No bundled node binary                             | Yes               |

These are artifact targets and detected native requirements. Consult the
validation record for platforms actually exercised. OS selection follows the
Gateway machine, including its container or VM, rather than the browser's OS.

## Build a local package

This directory is a standalone package. It can be moved into its own repository;
it does not import the surrounding CypherClaw source or require its build.
Use a Node.js version supported by the pinned OpenClaw release and pnpm 12.5.1.

```sh
cd cypher-plugin
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
npm pack --ignore-scripts --pack-destination /tmp
```

The package includes built JavaScript, browser assets, launch scripts, native
binaries, and their notices/source materials. Build dependencies remain local.
The native node's redistribution evidence and remaining source-completeness
limitations are described in `THIRD_PARTY_NOTICES.md`; inspect those before
publishing a release. No public npm package or release is created by these
commands.

## Install and open the page

Install the produced package into an existing official OpenClaw installation:

```sh
openclaw plugins install npm-pack:/tmp/cyphertroopers-openclaw-cypher-0.1.0.tgz --force
openclaw plugins inspect cypher --runtime --json
```

Review OpenClaw's capability and install-policy prompts. This plugin executes
its bundled native programs and accesses the operator-selected local Cypher
data and IPC endpoint. It does not register agent tools or send generated
wallets to a model.

Enable **Settings → Labs → Custom plugin UI** in OpenClaw. The corresponding
official setting is `gateway.controlUi.experimental.customPlugins: true`.
Follow the install command's instructions to load the plugin into the Gateway,
then open **Cypher** in the Control UI navigation. Installing the plugin does
not automatically start a node or connect to an existing IPC endpoint.

Open the Gateway through HTTPS or a browser-trusted localhost address. Native
plugin assets use the official authenticated, same-origin loading mechanism;
remote plain HTTP cannot provide the required secure asset authentication.

Use the existing authenticated Control UI connection. Reading status requires
`operator.read`; node operations and wallet generation require `operator.admin`.
The page does not need an AI provider or model profile to manage the node.

## Existing node data

The new-install default data directory is
`<OpenClaw state directory>/cypher/chaindbname`. It is outside the installed
plugin directory, so replacing a plugin package does not replace chain data
or keystore files.

For an existing CypherClaw installation, explicitly retain its current data
location before using **Start** in the new plugin. For example, set the existing
`CYPHER_DATADIR` environment variable to the absolute path of its
`cypher/chaindbname` directory in the environment that starts the official
OpenClaw Gateway. Set `CYPHER_IPC_PATH` too if the old node uses a custom endpoint.
Use the actual old paths, rather than the illustrative directory names here.

The existing `CYPHER_ROOT` override still selects an external Cypher runtime
directory, including its launchers and binaries. An explicit relative
`CYPHER_DATADIR` retains the launcher's root-relative interpretation; an absolute
path makes migration ownership clearer. The plugin does not move, initialize,
or delete an existing data directory during installation.

Stop an old managed node through its current owner before starting the same
data directory in a new Gateway. Alternatively, keep the existing process and
use **Connect IPC**. A connected external process is not owned by the plugin:
**Disconnect IPC** detaches, and the plugin cannot stop that process.

Existing launcher environment settings remain available, including
`CYPHER_HEADLESS`, `CYPHER_RPC_ENABLED`, `CYPHER_RPC_BIND`, `CYPHER_WS_BIND`,
`CYPHER_BOOTNODE_HOST`, `CYPHER_BROWSER_RELAY`, and
`CYPHER_BROWSER_RELAY_CONFIG`. The bundled launchers retain their existing
network and browser-relay defaults. The relay configuration shipped here is
the public Common-node configuration from the original runtime.

## Stop and request timing

The Control UI's request deadline does not limit node uptime. A started node
continues until it exits or its owner requests shutdown.

**Stop** sends one graceful interrupt and immediately reports **Stopping**.
The page checks status until the process is confirmed stopped. If graceful
shutdown has not completed within 30 seconds, the page reports the failure
and retains process ownership. The plugin does not send a force-kill signal
because that interval elapsed. Check the node before retrying. Windows also
requires the IPC endpoint to stop responding before confirming shutdown.

Wallet generation has a separate 25-second request deadline, including binary
preparation and execution. At that deadline the request reports an error and
cancels the one-shot generator. If operating-system cleanup takes longer, the
plugin retains ownership and refuses another generation until cleanup settles.
This leaves room within the official UI's 30-second request window. It never
stops a Cypher node.

## Generated wallet handling

The page displays the generated address and initially masks the private key.
It provides reveal, copy, and clear actions. Treat the result as a newly
generated wallet that must be saved by the operator: it is not imported into
the node keystore and is not recoverable from plugin status.

The generator uses the bundled program for the Gateway's OS/CPU, verifies its
pinned SHA-256, and runs it with fixed arguments and an empty credential
environment. Generation does not need network access. Output is bounded and
process buffers are cleared after parsing. The result is held only for the
authenticated reply and the current page view, and is cleared from the page
when navigation, connection, or permission changes invalidate that view.

The plugin does not deliberately write the result into configuration, logs,
browser storage, or a job database. Clearing the page is not a claim that
JavaScript strings or an operating system's memory can be securely erased.
The operator's clipboard remains under their control. Wallet generation on a
remote Gateway sends the result over its existing authenticated connection;
use the same secure transport required for operating that Gateway.

## Updates and development

Keep OpenClaw and this plugin as separate packages. After producing a new
plugin package, install that package through the same managed plugin command.
The service lifecycle cancels active generation and gracefully settles a
plugin-owned node during shutdown. A package update therefore is not a promise
of uninterrupted node uptime. An externally owned node remains under its
existing process manager.

The plugin uses only documented `openclaw/plugin-sdk/*` imports. Its browser
bundle owns its UI components and communicates through the public Control UI
host. `src/public-process-runtime.d.ts` supplies two precise declarations missing
from the pinned release's otherwise public runtime subpath; remove it when
OpenClaw publishes those types.

Before changing supported host versions, run the focused tests and repeat the
managed tarball install and browser proof against the selected official host.
The project intentionally carries no OpenClaw fork branding, agent changes,
update scripts, or inherited release workflows.
