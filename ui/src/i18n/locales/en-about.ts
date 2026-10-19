import type { TranslationMap } from "../lib/types.ts";
import { en } from "./en.ts";

const enAbout = {
  aboutPage: {
    productName: "CypherClaw",
    tagline: "Your personal AI assistant, running on your own devices.",
    waveHello: "Wave hello to CypherTrooper",
    linksLabel: "CypherClaw and upstream resources",
    forkNotice:
      "CypherClaw is an independent fork of OpenClaw and is not affiliated with or endorsed by the OpenClaw Foundation.",
    linkWebsite: "OpenClaw website (upstream)",
    linkDocs: "OpenClaw docs (upstream)",
    linkGitHub: "CypherClaw on GitHub",
    linkUpstreamGitHub: "OpenClaw on GitHub (upstream)",
    linkDiscord: "OpenClaw Discord (upstream)",
    linkX: "OpenClaw on X (upstream)",
    linkChangelog: "OpenClaw changelog (upstream)",
    license: "© 2026 OpenClaw Foundation — MIT License.",
    artifactTitle: "Control UI",
    artifactSubtitle: "Identity embedded when this browser artifact was built.",
    artifactDetails: en.aboutPage.artifactDetails,
    version: "Version",
    commit: en.aboutPage.commit,
    branch: "Branch",
    built: en.aboutPage.built,
    unavailable: en.aboutPage.unavailable,
    copyCommit: en.aboutPage.copyCommit,
    copyingCommit: "Copying commit hash",
    copiedCommit: en.aboutPage.copiedCommit,
    copyCommitFailed: "Could not copy commit hash",
    gateway: en.aboutPage.gateway,
    gatewayVersion: "Connected Gateway version",
    gatewayVersionHint:
      "Reported by the active Gateway connection; separate from this Control UI build.",
  },
} satisfies TranslationMap;

export const registerAboutEnglish = Object.assign(
  () => Object.assign(en.aboutPage, enAbout.aboutPage),
  { catalog: enAbout },
);
