import type { ResourceChange } from '@burnmap/parser';
import { ACTION_GLYPH, ACTION_KIND } from '../glyphs';
import { formatAttr, isHighRisk, relativeAddress } from '../model-view';

export function anchorId(address: string): string {
  // Lossless, injective id: encodeURIComponent is reversible, so two distinct
  // addresses can never collide (e.g. "...foo-bar" vs "...foo.bar" map to
  // different ids). DangerIndex links use this same function, so index anchors
  // always match row ids. Percent-escapes are valid in HTML ids and URL fragments.
  return `r-${encodeURIComponent(address)}`;
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
