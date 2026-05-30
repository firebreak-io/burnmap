import type { OutputChange } from '@burnmap/parser';
import { ACTION_LABEL } from '../glyphs';

export function Outputs({ outputs }: { outputs: OutputChange[] }) {
  if (outputs.length === 0) return null;
  return (
    <div className="group outputs">
      <p className="group-h">outputs <span className="cnt">· {outputs.length}</span></p>
      {outputs.map((o) => (
        <div className="row" key={o.name}>
          <span className="addr">{o.name}</span>
          <span className="out-action">
            {ACTION_LABEL[o.action]}{o.sensitive ? ' · sensitive' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
