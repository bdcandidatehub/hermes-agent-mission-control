"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const pathLabels: Record<string, string> = {
  "/": "Today",
  "/pipeline": "Pipeline",
  "/hermes": "Hermes",
  "/memory-wiki": "Memory Wiki",
};

export function Breadcrumbs() {
  const pathname = usePathname();
  
  // Don't show breadcrumbs on dashboard
  if (pathname === "/") return null;
  
  const currentLabel = pathLabels[pathname] || "Page";
  
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--text-3)] mb-6">
      <Link 
        href="/" 
        className="hover:text-neutral-300 transition-colors"
      >
        Today
      </Link>
      <span>/</span>
      <span className="text-neutral-400">{currentLabel}</span>
    </div>
  );
}
