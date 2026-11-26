import type { Metadata } from "next";
import { AnalystPage } from "@/components/pages/analyst";

export const metadata: Metadata = { title: "AI analyst" };

export default function Page() {
  return <AnalystPage />;
}
