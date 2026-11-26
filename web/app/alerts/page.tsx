import type { Metadata } from "next";
import { AlertsPage } from "@/components/pages/alerts";

export const metadata: Metadata = { title: "Emerging issues" };

export default function Page() {
  return <AlertsPage />;
}
