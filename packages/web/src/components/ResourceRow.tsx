import type { ResourceChange } from '@burnmap/parser';
import { ACTION_GLYPH, ACTION_KIND } from '../glyphs';
import { formatAttr, isHighRisk, relativeAddress } from '../model-view';

function anchorId(address: string): string {
  // Preserve underscores (common in resource type names); collapse other
  // non-alphanumerics to '-'. The DangerIndex links use this same function,
  // so index anchors always match row ids.
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
  const isUpdate = rc.action === 'update';
  const showFullDetail = hot;
  const showCompact = isUpdate && !hot && rc.attrs.length > 0;

  return (
    <div className={`item${hot ? ' hot' : ''}`} id={anchorId(rc.address)}>
      <div className="row">
        <span className={`glyph g-${ACTION_KIND[rc.action]}`}>{ACTION_GLYPH[rc.action]}</span>
        <AddressLabel rc={rc} />
        <Badge rc={rc} />
      </div>

      {showFullDetail && (
        <div className="detail">
          {rc.dangerReasons.map((reason) => (
            <p className="reason" key={reason}>{reason}</p>
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

export { anchorId };
