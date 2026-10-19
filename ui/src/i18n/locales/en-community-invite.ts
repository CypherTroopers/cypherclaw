import type { TranslationMap } from "../lib/types.ts";
import { en } from "./en.ts";

const enCommunityInvite = {
  communityInvite: {
    title: "Pull up a chair.",
    body: "There’s a place for you in the AI future. Join the upstream OpenClaw community on Reddit, Discord, and X.",
    join: "Join",
    follow: "Follow",
    joinPlatform: "Join the OpenClaw community on {platform}",
    followPlatform: "Follow OpenClaw on {platform}",
    dismissForever: "Dismiss and don't show again",
    dismissFailed: "Invitation dismissed, but your preference couldn't be saved.",
  },
} satisfies TranslationMap;

export const registerCommunityInviteEnglish = Object.assign(
  () => Object.assign(en, enCommunityInvite),
  { catalog: enCommunityInvite },
);
