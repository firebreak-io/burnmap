// Minimal shape of the `configuration` section of `tofu show -json <plan>`.
// Only fields the diagram consumes are typed; everything else is ignored.

export interface RawConfigResource {
  address: string;       // module-relative, no index, e.g. "aws_subnet.app"
  mode: string;          // "managed" | "data"
  type: string;
  name: string;
  expressions?: Record<string, unknown>;
}

export interface RawModuleCall {
  source?: string;
  expressions?: Record<string, unknown>;
  module?: RawConfigModule;
}

export interface RawConfigModule {
  resources?: RawConfigResource[];
  module_calls?: Record<string, RawModuleCall>;
}

export interface RawConfiguration {
  root_module?: RawConfigModule;
}
