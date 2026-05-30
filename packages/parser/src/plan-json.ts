// Minimal shape of `tofu show -json <planfile>` output that the parser reads.
// Only fields burnmap consumes are typed; everything else is ignored.

export interface RawChange {
  /** e.g. ["create"], ["update"], ["delete"], ["no-op"], ["read"],
   *  ["create","delete"] or ["delete","create"] for a replace. */
  actions: string[];
  before: unknown;
  after: unknown;
  /** Mirrors `after` structure with `true` at attributes "known after apply". */
  after_unknown?: unknown;
  /** Mirrors structure with `true` at sensitive attributes (or `false`). */
  before_sensitive?: unknown;
  after_sensitive?: unknown;
  /** Attribute paths (arrays of string/number segments) that force replacement. */
  replace_paths?: Array<Array<string | number>>;
}

export interface RawResourceChange {
  address: string;
  module_address?: string;
  mode: string;
  type: string;
  name: string;
  index?: string | number;
  provider_name: string;
  change: RawChange;
}

export interface RawPlan {
  format_version?: string;
  terraform_version?: string;
  resource_changes?: RawResourceChange[];
  output_changes?: Record<string, RawChange>;
  resource_drift?: RawResourceChange[];
}
