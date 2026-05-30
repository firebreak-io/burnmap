import type { Action, AttrChange } from './types.js';

/** Resource-type patterns whose destroy/replace risks data loss or downtime. */
const STATEFUL = [
  /_db_instance/, /_rds_/, /rds_cluster/, /dynamodb_table/, /s3_bucket/,
  /_ebs_volume/, /_efs_/, /elasticache/, /redshift/, /docdb/, /_volume$/, /database/,
];

const BASE: Record<Action, number> = {
  delete: 70, replace: 60, update: 20, create: 10, read: 0, 'no-op': 0,
};

/** Compute a tunable danger score + human reasons for a resource change. */
export function scoreDanger(
  type: string,
  action: Action,
  attrs: AttrChange[],
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = BASE[action];
  const stateful = STATEFUL.some((re) => re.test(type));

  if ((action === 'delete' || action === 'replace') && stateful) {
    score += 30;
    reasons.push(
      action === 'delete'
        ? 'destroys a stateful resource — data not recoverable after apply'
        : 'replacement recreates a stateful resource — possible data loss/downtime',
    );
  } else if (action === 'delete') {
    reasons.push('resource will be destroyed');
  } else if (action === 'replace') {
    reasons.push('resource will be replaced (destroy + create)');
  }

  const forced = attrs.filter((a) => a.forcesReplacement).map((a) => a.path);
  if (forced.length > 0) {
    score += 10;
    reasons.push(`forces replacement: ${forced.join(', ')}`);
  }

  // De-escalate purely cosmetic updates (tags / description / comment only).
  // Never de-escalate when something forces replacement — that signal must stay loud.
  if (
    action === 'update' &&
    forced.length === 0 &&
    attrs.length > 0 &&
    attrs.every((a) => /^tags(\.|\[|$)/.test(a.path) || /^(description|comment)$/.test(a.path))
  ) {
    score = 5;
  }

  return { score, reasons };
}
