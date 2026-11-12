import type { PermissionAction } from "./agents.ts";

/** Notes shown above a tool's agent access, each as one muted line. */
export interface AccessNotes {
  /** Shown for every tool. */
  readonly always?: readonly string[];
  /** Shown for tools checked under these permission names, such as `edit` for `write`. */
  readonly permission?: Readonly<Record<string, readonly string[]>>;
  /** Shown for these tool ids. */
  readonly tool?: Readonly<Record<string, readonly string[]>>;
}

/** What differs between the hosts Tool Inspector runs in. */
export interface Host {
  /** The host's name in messages, such as "OpenCode". */
  readonly name: string;
  /** How a tool's detail words each configured permission action. */
  readonly actionLabels: Readonly<Record<PermissionAction, string>>;
  /** Host behaviour that the configured rules alone don't show. */
  readonly accessNotes: AccessNotes;
}
