import Link from "next/link"
import type { SelectedUser } from "#shared/flags"
import { UserSwitcher } from "#features/shell/user-switcher"

const links = [
  ["/", "Overview"],
  ["/admin", "Admin"],
  ["/server", "Server"],
  ["/client", "Client"],
  ["/matrix", "Matrix"],
  ["/advanced", "Advanced"],
] as const

export function SiteHeader({ selected }: { selected: SelectedUser }) {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="brand" href="/">
          <span className="brand-mark">G</span> gated
        </Link>
        <nav>
          {links.map(([href, label]) => (
            <Link href={href} key={href}>
              {label}
            </Link>
          ))}
        </nav>
        <UserSwitcher selected={selected} />
      </div>
    </header>
  )
}
