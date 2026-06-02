import type { ChangeModel } from '@burnmap/parser';
import { SummaryPills } from './SummaryPills';
import { DangerIndex } from './DangerIndex';
import { ModuleGroupView } from './ModuleGroupView';
import { Outputs } from './Outputs';
import { NoChanges } from './NoChanges';
import { hasResourceChanges } from '../model-view';

export function App({ model }: { model: ChangeModel }) {
  const { meta } = model;
  return (
    <div className="wrap">
      <div className="card">
        <div className="card-head">
          <span className="brand"><span className="spark">▰</span> burnmap</span>
          <span className="ctx">{meta.repo} · PR #{meta.prNumber} · {meta.commitSha}</span>
        </div>
        <div className="body">
          <SummaryPills summary={model.summary} />
          <DangerIndex model={model} />
          {hasResourceChanges(model)
            ? model.modules.map((group) => (
                <ModuleGroupView group={group} key={group.module || 'root'} />
              ))
            : (
                <NoChanges />
              )}
          <Outputs outputs={model.outputs} />
        </div>
      </div>
    </div>
  );
}
