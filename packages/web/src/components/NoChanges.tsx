/** Shown in place of the module list when a plan has no resource changes. */
export function NoChanges() {
  return (
    <div className="empty">
      <span className="empty-mark">✓</span>
      <p className="empty-h">No infrastructure changes</p>
      <p className="empty-sub">This plan won't create, update, or destroy any resources.</p>
    </div>
  );
}
