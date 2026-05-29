import type { ChangeSummary } from '@burnmap/parser';

interface Pill { kind: string; label: string; count: number; }

export function SummaryPills({ summary }: { summary: ChangeSummary }) {
  const pills: Pill[] = [
    { kind: 'create', label: 'add', count: summary.create },
    { kind: 'update', label: 'change', count: summary.update },
    { kind: 'replace', label: 'replace', count: summary.replace },
    { kind: 'destroy', label: 'destroy', count: summary.delete },
  ];
  return (
    <div className="summary">
      {pills.filter((p) => p.count > 0).map((p) => (
        <span key={p.kind} className={`pill ${p.kind}`}>
          <span className="n">{p.count}</span> {p.label}
        </span>
      ))}
    </div>
  );
}
