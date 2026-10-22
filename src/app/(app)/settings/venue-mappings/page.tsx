import { redirect } from "next/navigation";

// Venue matching moved onto Locations; keep old links working.
export default function VenueMappingsRedirect() {
  redirect("/settings/locations#venues");
}
