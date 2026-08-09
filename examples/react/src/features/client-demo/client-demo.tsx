"use client"

import dynamic from "next/dynamic"

const ClientShowcase = dynamic(
  () => import("#features/client-demo/client-showcase").then((module) => module.ClientShowcase),
  {
    loading: () => <div className="loading-panel">Loading client evaluation harness…</div>,
    ssr: false,
  }
)

export function ClientDemo() {
  return <ClientShowcase />
}
