import type { ResourceChange } from '@burnmap/parser';
import { ACTION_GLYPH, ACTION_KIND } from '../glyphs';
import { formatAttr, isHighRisk, relativeAddress } from '../model-view';

export function anchorId(address: string): string {
  // Preserve underscores (common in resource type names); collapse other
  // non-alphanumerics to '-'. DangerIndex links use this same function, so
  // index anchors always match row ids.
  // Limitation: '.' and '-' both collapse to '-', so two addresses differing
  // only by '.'/'-' would collide. Real Terraform addresses use '.' purely as a
  // structural separator and never contain literal hyphens in type/module
  // segments, so collisions are not expected in practice.
  return `r-${address.replace(/[^a-zA-Z0-9_]+/g, '-')}`;
}

function AddressLabel({ rc }: { rc: ResourceChange }) {
  const rel = relativeAddress(rc);
  const prefix = `${rc.type}.`;
  const rest = rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;
  return (
    <span className="addr">
      <span className="type">{prefix}</span>
      {rest}
    </span>
  );
}

function Badge({ rc }: { rc: ResourceChange }) {
  if (rc.action === 'delete') return <span className="badge del">destroy</span>;
  if (rc.action === 'replace') {
    const forced = rc.attrs.some((a) => a.forcesReplacement);
    return <span className="badge force">{forced ? 'force replace' : 'replace'}</span>;
  }
  return null;
}

export function ResourceRow({ rc }: { rc: ResourceChange }) {
  const hot = isHighRisk(rc);
  const showCompact = rc.action === 'update' && !hot && rc.attrs.length > 0;

  return (
    <div className={`item${hot ? ' hot' : ''}`} id={anchorId(rc.address)}>
      <div className="row">
        <span className={`glyph g-${ACTION_KIND[rc.action]}`}>{ACTION_GLYPH[rc.action]}</span>
        <AddressLabel rc={rc} />
        <Badge rc={rc} />
      </div>

      {hot && (
        <div className="detail">
          {rc.dangerReasons.map((reason, i) => (
            <p className="reason" key={i}>{reason}</p>
          ))}
          {rc.attrs.map((a) => {
            const text = formatAttr(a);
            return (
              <div className="attr" key={a.path}>
                <span className="k">{text}</span>
                {a.forcesReplacement && <span className="forces"> (forces replacement)</span>}
              </div>
            );
          })}
        </div>
      )}

      {showCompact && (
        <div className="more">{rc.attrs.map((a) => formatAttr(a)).join(' · ')}</div>
      )}
    </div>
  );
}
