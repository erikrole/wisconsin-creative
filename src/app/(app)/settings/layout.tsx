import { Lato } from "next/font/google";
import SettingsTheme from "./SettingsTheme";
import SettingsShell from "./SettingsShell";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-settings className={`wc-fresh ${lato.variable}`}>
      <SettingsTheme classNames={`wc-fresh ${lato.variable}`} />
      <SettingsShell>{children}</SettingsShell>
    </div>
  );
}
