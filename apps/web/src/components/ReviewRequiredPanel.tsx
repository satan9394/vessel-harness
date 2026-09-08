import type { ReviewRecord } from '../team';

/**
 * External Review Required section (task 060, docs §9.1 UI elements):
 * Copy Handoff / Open Folder / Import Result bound to the 059 handoff records
 * the local server stores. Only pending reviews show as "External Review
 * Required"; imported records collapse to a result summary row. Presentational —
 * the actions are provided by the container (which owns the api calls).
 */
export interface ReviewRequiredPanelProps {
  reviews: ReviewRecord[];
  busy?: boolean;
  onCopy: (review: ReviewRecord) => void;
  onOpenFolder: (review: ReviewRecord) => void;
  /** fired with the imported text (file content / pasted payload) */
  onImport: (review: ReviewRecord, text: string) => void;
}

export default function ReviewRequiredPanel({ reviews, busy = false, onCopy, onOpenFolder, onImport }: ReviewRequiredPanelProps) {
  if (reviews.length === 0) return null;
  return (
    <div className="review-required" data-testid="review-required">
      {reviews.some((r) => r.status === 'pending') && <div className="review-required-title">External Review Required</div>}
      {reviews.map((review) => (
        <div className={`review-row review-row-${review.status}`} key={review.id}>
          <div className="review-row-head">
            <span className="review-status">{review.status === 'pending' ? 'pending' : 'imported'}</span>
            <span className="review-id dim" title={review.workspaceRoot ?? ''}>
              {review.id}
            </span>
          </div>
          <div className="review-task" title={review.task}>
            {review.task}
          </div>
          {review.status === 'imported' && review.results.length > 0 && (
            <div className="review-results">
              {review.results.map((r) => (
                <div key={r.id} className={`review-result review-result-${r.conclusion.verdict}`}>
                  {r.source} · {r.conclusion.verdict}
                  {r.conclusion.reason ? ` — ${r.conclusion.reason}` : ''}
                </div>
              ))}
            </div>
          )}
          <div className="review-actions">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => onCopy(review)}
              title="copy the handoff.md artifact for the external reviewer"
            >
              Copy Handoff
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => onOpenFolder(review)}
              title="open .vessel/reviews/<id> in the OS file manager"
            >
              Open Folder
            </button>
            <label className="btn review-import-label">
              Import Result
              <input
                type="file"
                accept=".txt,.md,.json"
                className="review-import-input"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void file.text().then((text) => onImport(review, text)).catch(() => undefined);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
      ))}
    </div>
  );
}
