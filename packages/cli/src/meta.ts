import type { RawPlan, ChangeMeta } from '@burnmap/parser';

/**
 * CLI default metadata. There is no PR / repo / commit in a standalone run, so
 * those are blank; the plan file is authoritative for the Terraform version.
 * Structurally identical to graph's ArchMeta, so it serves both renderers.
 */
export function buildMeta(plan: RawPlan, now: string): ChangeMeta {
  return {
    repo: '',
    prNumber: 0,
    commitSha: '',
    terraformVersion: plan.terraform_version ?? 'unknown',
    generatedAt: now,
  };
}
