export const retainPreviewSql = "UPDATE wc_preview_meta.runtime SET last_seen_at=now(), pinned=coalesce($1::boolean,pinned) WHERE id=true AND cleanup_started_at IS NULL RETURNING id";
export const claimPreviewCleanupSql = "UPDATE wc_preview_meta.runtime SET cleanup_started_at=coalesce(cleanup_started_at,now()) WHERE id=true AND NOT pinned AND git_deleted_at=$1::timestamptz AND last_seen_at=$2::timestamptz AND git_deleted_at <= now()-($3::integer*interval '1 day') AND last_seen_at <= now()-($3::integer*interval '1 day') RETURNING id";
export async function retainPreview(sql, pinned = null) {
  if (!(await sql.query(retainPreviewSql, [pinned])).length) throw new Error("This preview is being retired. Start a new branch environment; do not reuse its credentials.");
}
