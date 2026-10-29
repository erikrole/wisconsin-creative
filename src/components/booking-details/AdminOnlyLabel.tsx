/** Label for an action only admins can take: Badger red fading to violet. */
export function AdminOnlyLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-gradient-to-r from-[#c5050c] to-[#7c3aed] bg-clip-text font-medium text-transparent dark:from-[#ff7a80] dark:to-[#b794f6]">
      {children}
    </span>
  );
}
