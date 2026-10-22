import { redirect } from "next/navigation";

// Extend presets moved onto Checkout policies; keep old links working.
export default function BookingSettingsRedirect() {
  redirect("/settings/checkout-policies#extend-presets");
}
