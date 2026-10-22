import { redirect } from "next/navigation";

// The audit log lives in Reports; keep old links working.
export default function AuditLogRedirect() {
  redirect("/reports/audit");
}
