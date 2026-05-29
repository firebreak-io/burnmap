import type { ChangeModel } from '@burnmap/parser';
import { highRiskList } from '../model-view';
import { ACTION_GLYPH } from '../glyphs';
import { anchorId } from './ResourceRow';

export function DangerIndex({ model }: { model: ChangeModel }) {
  const items = highRiskList(model);
  if (items.length === 0) return null;
  return (
    <div className="index">
      <span className="lbl">⚠ {items.length} high-risk</span>
      {items.map((rc) => (
        <a className="chip" href={`#${anchorId(rc.address)}`} key={rc.address}>
          <span className={`tag ${rc.action === 'delete' ? 'd' : 'r'}`}>{ACTION_GLYPH[rc.action]}</span>
          {rc.address}
        </a>
      ))}
    </div>
  );
}
