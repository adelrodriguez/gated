"use client"

import { useState } from "react"

export function MemoryNote() {
  const [visible, setVisible] = useState(true)
  if (!visible) return null
  return (
    <div className="notice shell row">
      <span>
        <strong>Demo memory only.</strong> State resets on restart and may differ between Vercel
        instances.
      </span>
      <button className="button secondary" onClick={() => setVisible(false)} type="button">
        Dismiss
      </button>
    </div>
  )
}
