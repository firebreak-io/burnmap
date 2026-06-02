import type { ChangeSummary } from '@burnmap/parser';

interface Pill { kind: string; label: string; count: number; }

export function SummaryPills({ summary }: { summary: ChangeSummary }) {
  const pills: Pill[] = [
    { kind: 'create', label: 'add', count: summary.create },
    { kind: 'update', label: 'change', count: summary.update },
    { kind: 'replace', label: 'replace', count: summary.replace },
    { kind: 'destroy', label: 'destroy', count: summary.delete },
  ];
  const visible = pills.filter((p) => p.count > 0);
  if (visible.length === 0) return null;
  return (
    <div className="summary">
      {visible.map((p) => (
        <span key={p.kind} className={`pill ${p.kind}`}>
          <span className="n">{p.count}</span> {p.label}
        </span>
      ))}
    </div>
  );
}
