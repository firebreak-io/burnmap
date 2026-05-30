import type {
  ChangeMeta, ChangeModel, ChangeSummary, ResourceChange,
} from './types.js';
import type { RawPlan, RawResourceChange } from './plan-json.js';
import { mapAction } from './actions.js';
import { diffAttributes } from './attributes.js';
import { scoreDanger } from './danger.js';
import { groupByModule, parseOutputs } from './grouping.js';

function emptySummary(): ChangeSummary {
  return { create: 0, update: 0, delete: 0, replace: 0, noop: 0, read: 0 };
}

function bump(summary: ChangeSummary, action: ResourceChange['action']): void {
  if (action === 'no-op') summary.noop += 1;
  else summary[action] += 1;
}

/** Build a ResourceChange from a raw tofu resource change. */
function toResourceChange(rc: RawResourceChange): ResourceChange {
  const action = mapAction(rc.change.actions);
  const attrs = diffAttributes(rc.change, action);
  const { score, reasons } = scoreDanger(rc.type, action, attrs);
  return {
    address: rc.address,
    module: rc.module_address ?? '',
    type: rc.type,
    name: rc.name,
    provider: rc.provider_name,
    action,
    attrs,
    dangerScore: score,
    dangerReasons: reasons,
  };
}

/** Parse a `tofu show -json` plan into the normalized ChangeModel. */
export function parsePlan(plan: RawPlan, meta: ChangeMeta): ChangeModel {
  const summary = emptySummary();
  const displayed: ResourceChange[] = [];

  for (const rc of plan.resource_changes ?? []) {
    const model = toResourceChange(rc);
    bump(summary, model.action);
    // no-op and read changes are counted but not shown in the manifest.
    if (model.action === 'no-op' || model.action === 'read') continue;
    displayed.push(model);
  }

  const drift = (plan.resource_drift ?? []).map(toResourceChange);

  return {
    meta: { ...meta, terraformVersion: plan.terraform_version ?? meta.terraformVersion },
    summary,
    modules: groupByModule(displayed),
    outputs: parseOutputs(plan.output_changes ?? {}),
    ...(drift.length > 0 ? { drift } : {}),
  };
}
