import type { ModuleGroup } from '@burnmap/parser';
import { ResourceRow } from './ResourceRow';

export function ModuleGroupView({ group }: { group: ModuleGroup }) {
  const count = group.types.reduce((n, t) => n + t.resources.length, 0);
  return (
    <div className="group">
      <p className="group-h">
        {group.module || 'root'} <span className="cnt">· {count}</span>
      </p>
      {group.types.flatMap((t) => t.resources).map((rc) => (
        <ResourceRow rc={rc} key={rc.address} />
      ))}
    </div>
  );
}
