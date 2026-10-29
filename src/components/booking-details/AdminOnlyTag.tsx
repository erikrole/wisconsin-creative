import { ShieldIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Quiet marker for actions only admins can take. */
export function AdminOnlyTag() {
  return (
    <Badge variant="gray" size="sm" className="ml-auto font-medium">
      <ShieldIcon aria-hidden />
      Admin
    </Badge>
  );
}
