import type { Host } from "@lunchbox-labs/tool-inspector-core";

const protectedConfigPaths = [
  "Kilo checks protected config paths separately; broad read grants do not automatically authorize sensitive .env files.",
];

/**
 * Kilo applies call-time checks beyond the configured rules, so its labels and notes say that
 * the detail shows configuration rather than a final authorization decision.
 */
export const kiloHost: Host = {
  name: "Kilo",
  actionLabels: {
    allow: "allowed by configured rules",
    ask: "asks first by configured rules",
    deny: "denied by configured rules",
  },
  accessNotes: {
    always: [
      "Configured rules only. Kilo can still ask or deny at call time; saved approvals, hard limits, skill commands and sandbox escalation are not resolved here.",
    ],
    permission: { read: protectedConfigPaths, edit: protectedConfigPaths },
    tool: {
      agent_manager: [
        "Agent manager prompt, stop, move and answer actions need exact action rules; broad grants can still ask first.",
      ],
    },
  },
};
