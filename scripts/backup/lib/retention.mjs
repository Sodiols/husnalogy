/**
 * Backup retention: which runs at the destination to keep. Pure planning —
 * deletion happens only when a policy is configured (BACKUP_RETENTION) AND
 * approved (BACKUP_RETENTION_APPROVED=yes); otherwise the plan is only
 * reported (dry run).
 *
 * Safety rules, whatever the policy says:
 *   - the newest COMPLETE run is always kept;
 *   - with no complete run at all, nothing is deleted;
 *   - incomplete runs (no COMPLETE.json) younger than 48 h are kept (an upload
 *     may still be in progress); older ones are partial uploads and removable;
 *   - complete runs are kept per bucket: the newest of each of the last
 *     `daily` days, `weekly` ISO weeks and `monthly` months (UTC).
 */
export const PROPOSED_RETENTION = { daily: 14, weekly: 8, monthly: 12 };
const INCOMPLETE_GRACE_MS = 48 * 3_600_000;

export function parseRetentionPolicy(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const policy = { daily: 0, weekly: 0, monthly: 0 };
  for (const part of text.split(",")) {
    const [name, raw] = part.split("=").map((item) => item.trim());
    const count = Number(raw);
    if (!(name in policy) || !Number.isInteger(count) || count < 0 || count > 1000) {
      throw new Error(`BACKUP_RETENTION must look like "daily=14,weekly=8,monthly=12" (got "${text}")`);
    }
    policy[name] = count;
  }
  if (!policy.daily && !policy.weekly && !policy.monthly) throw new Error("BACKUP_RETENTION keeps nothing; refusing");
  return policy;
}

export function runTime(runId) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(runId);
  return match ? Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]) : NaN;
}

function isoWeek(ms) {
  const date = new Date(ms);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${week}`;
}

/** { keep: [runId], remove: [runId], reasons: {runId: why} } */
export function planRetention(runs, policy, now = Date.now()) {
  const complete = runs.filter((run) => run.complete && Number.isFinite(runTime(run.runId))).sort((a, b) => runTime(b.runId) - runTime(a.runId));
  const keep = new Map();
  const remove = [];
  if (!complete.length) {
    for (const run of runs) keep.set(run.runId, "no complete backup exists: nothing is deleted");
    return { keep: [...keep.keys()], remove, reasons: Object.fromEntries(keep) };
  }
  keep.set(complete[0].runId, "newest complete backup");
  const buckets = [
    ["daily", policy.daily, (ms) => new Date(ms).toISOString().slice(0, 10)],
    ["weekly", policy.weekly, isoWeek],
    ["monthly", policy.monthly, (ms) => new Date(ms).toISOString().slice(0, 7)],
  ];
  for (const [label, count, keyOf] of buckets) {
    const seen = new Set();
    for (const run of complete) {
      const key = keyOf(runTime(run.runId));
      if (seen.has(key)) continue;
      if (seen.size >= count) break;
      seen.add(key);
      if (!keep.has(run.runId)) keep.set(run.runId, `${label} ${key}`);
    }
  }
  for (const run of runs) {
    if (keep.has(run.runId)) continue;
    if (!run.complete && now - runTime(run.runId) < INCOMPLETE_GRACE_MS) {
      keep.set(run.runId, "incomplete, may still be uploading");
      continue;
    }
    remove.push(run.runId);
  }
  return { keep: [...keep.keys()].sort(), remove: remove.sort(), reasons: Object.fromEntries(keep) };
}
