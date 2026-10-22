import type { Metadata } from "next";
import WrappedClient from "./WrappedClient";

export const metadata: Metadata = { title: "Creative Wrapped" };

export default function WrappedPage() {
  return <WrappedClient />;
}
