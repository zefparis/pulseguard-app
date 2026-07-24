/**
 * DemoGuard — PhaseHeader (compact, constant height)
 *
 * @copyright (c) 2026 Benjamin BARRERE / IA SOLUTION
 * Patents Pending FR2514274 | FR2514546
 */

interface Props {
  title: string;
  progress: string;
  progressPct?: number;
}

export function PhaseHeader({ title, progress, progressPct }: Props) {
  return (
    <div>
      <div className="phase-header">
        <h2>{title}</h2>
        <span className="phase-progress">{progress}</span>
      </div>
      {progressPct !== undefined && (
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
        </div>
      )}
    </div>
  );
}
