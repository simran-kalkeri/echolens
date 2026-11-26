import type { Metadata } from "next";
import { ThemesPage } from "@/components/pages/themes";

export const metadata: Metadata = { title: "Themes" };

export default function Page() {
  return <ThemesPage />;
}
