import type { AttendanceRecord } from '../db/database';
import { REQUEST_KINDS, REQUEST_LABELS } from '../utils/attendanceTimes';

const statusClass = { Pending: 'badge-amber', Approved: 'badge-green', Rejected: 'badge-red' } as const;

/** Small badges for a day's late check-in / long lunch / check-out requests; hover for details. */
export default function AttendanceRequestBadges({ rec }: { rec: AttendanceRecord }) {
  const kinds = REQUEST_KINDS.filter((k) => rec[k]);
  if (kinds.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
      {kinds.map((k) => {
        const r = rec[k]!;
        const details = [...r.reasons, r.note && `Reason: ${r.note}`, r.adminRemarks && `Admin: ${r.adminRemarks}`].filter(Boolean).join('\n');
        return (
          <span key={k} className={`badge ${statusClass[r.status]}`} style={{ fontSize: 10.5 }} title={details}>
            {REQUEST_LABELS[k]}: {r.status}
          </span>
        );
      })}
    </div>
  );
}
