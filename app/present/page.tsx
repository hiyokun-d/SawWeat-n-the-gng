import { Suspense } from "react";
import PresentClient from "./PresentClient";

export const metadata = {
  title: "GambutWatch | Presentasi",
};

export default function PresentPage() {
  return (
    <Suspense fallback={<div className="h-dvh w-full bg-slate-950" />}>
      <PresentClient />
    </Suspense>
  );
}
