"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { SelectedUser } from "#shared/flags"
import { UserSwitcher } from "#features/shell/user-switcher"

const links = [
  ["/", "Guide"],
  ["/admin", "Provider state"],
  ["/server", "Server"],
  ["/client", "React"],
  ["/matrix", "Identity matrix"],
  ["/advanced", "Lifecycle"],
] as const

export function SiteHeader({ selected }: { selected: SelectedUser }) {
  const pathname = usePathname()
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="brand" href="/">
          <span className="brand-mark">G</span> gated
        </Link>
        <nav aria-label="Technical demos">
          {links.map(([href, label]) => (
            <Link aria-current={pathname === href ? "page" : undefined} href={href} key={href}>
              {label}
            </Link>
          ))}
        </nav>
        <UserSwitcher selected={selected} />
      </div>
    </header>
  )
}
