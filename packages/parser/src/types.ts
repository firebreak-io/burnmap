export type Action = 'create' | 'update' | 'delete' | 'replace' | 'no-op' | 'read';

export type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface AttrChange {
  path: string;                 // "instance_type", "tags.Name", "ingress[0].cidr"
  before: JsonValue | null;
  after: JsonValue | null;
  sensitive: boolean;           // value redacted to «sensitive»
  unknown: boolean;             // "(known after apply)"
  forcesReplacement: boolean;
}

export interface ResourceChange {
  address: string;              // "module.vpc.aws_subnet.public[0]"
  module: string;               // "module.vpc" ("" = root)
  type: string;                 // "aws_subnet"
  name: string;                 // "public"
  provider: string;
  action: Action;
  attrs: AttrChange[];          // only changed paths; empty for create/delete
  dangerScore: number;
  dangerReasons: string[];
}

export interface OutputChange {
  name: string;
  action: Action;
  sensitive: boolean;
}

export interface ResourceTypeGroup {
  type: string;
  resources: ResourceChange[];
}

export interface ModuleGroup {
  module: string;
  types: ResourceTypeGroup[];
}

export interface ChangeSummary {
  create: number;
  update: number;
  delete: number;
  replace: number;
  noop: number;
  read: number;
}

export interface ChangeMeta {
  repo: string;
  prNumber: number;
  commitSha: string;
  terraformVersion: string;
  generatedAt: string;          // ISO 8601
}

export interface ChangeModel {
  meta: ChangeMeta;
  summary: ChangeSummary;
  modules: ModuleGroup[];
  outputs: OutputChange[];
  drift?: ResourceChange[];
}
