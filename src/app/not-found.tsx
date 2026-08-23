import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="px-10 text-center max-w-[480px] mt-20 mx-auto">
      <h1 className="mb-2">Page not found</h1>
      <p className="text-muted-foreground text-sm mb-6">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Button asChild>
        <Link href="/">Go home</Link>
      </Button>
    </div>
  );
}
