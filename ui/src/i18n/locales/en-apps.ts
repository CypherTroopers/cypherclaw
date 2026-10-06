import type { TranslationMap } from "../lib/types.ts";
import { en } from "./en.ts";

const enApps = {
  appsPage: {
    heroTitle: "Take CypherClaw everywhere",
    heroTagline:
      "Explore upstream OpenClaw companion apps and community resources. These downloads are maintained by OpenClaw; compatibility with this fork must be checked.",
    sectionMobile: "On your phone",
    havePhone: "Already have the app?",
    pairDevice: "Pair your device",
    sectionWatch: "On your wrist",
    sectionDesktop: "On your desktop",
    sectionBrowser: "In your browser",
    sectionCommunity: "Community",
    badgeBundledIos: "Included with the iOS app",
    badgeBundledAndroid: "Included with the Android app",
    ctaAppStore: "App Store",
    ctaPlayStore: "Google Play",
    ctaDownload: "Download",
    ctaOpenMac: "Open in Mac app",
    ctaDocs: "OpenClaw docs (upstream)",
    ctaSetupGuide: "Setup guide",
    ctaChromeWebStore: "Chrome Web Store",
    ctaOpenPlugins: "Open Plugins",
    ctaBrowseClawHub: "Browse ClawHub",
    linkDiscord: "OpenClaw community (upstream)",
    linkDocs: "OpenClaw docs (upstream)",
    cards: {
      ios: {
        title: "iPhone · OpenClaw (upstream)",
        desc: "Chat, talk, approve actions, and share into OpenClaw from iOS.",
      },
      android: {
        title: "Android · OpenClaw (upstream)",
        desc: "Your Android phone as a full OpenClaw device — chat, camera, and Canvas.",
      },
      appleWatch: {
        title: "Apple Watch · OpenClaw (upstream)",
        desc: "Glanceable chats and quick replies from your wrist.",
      },
      wearOs: {
        title: "Wear OS · OpenClaw (upstream)",
        desc: "The Android companion extends OpenClaw to your watch.",
      },
      macos: {
        title: "macOS · OpenClaw (upstream)",
        desc: "Menu bar companion for your Gateway — notifications, approvals, quick chat.",
      },
      windows: {
        title: "Windows · OpenClaw (upstream)",
        desc: "The Windows companion connects your PC as an OpenClaw device.",
      },
      linux: {
        title: "Linux · OpenClaw (upstream)",
        desc: "Native desktop app — .deb and AppImage builds.",
      },
      chrome: {
        title: "Chrome extension · OpenClaw (upstream)",
        desc: "Let OpenClaw drive your existing Chrome — tabs, pages, and forms.",
      },
      plugins: {
        title: "Plugins & ClawHub",
        desc: "Extend CypherClaw with channels, tools, and skills from the community.",
      },
    },
  },
} satisfies TranslationMap;

export const registerAppsEnglish = Object.assign(
  () => {
    Object.assign(en, enApps);
  },
  { catalog: enApps },
);
