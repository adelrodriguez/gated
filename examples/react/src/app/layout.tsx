import type { Metadata } from "next"
import { GateProvider } from "gated/react"
import { SiteHeader } from "#features/shell/site-header"
import { UsersProvider } from "#features/shell/users-provider"
import { getSelectedUser } from "#shared/server/user"
import "./globals.css"

export const metadata: Metadata = {
  title: "Gated React Example",
  description: "An interactive example of the gated feature-flag library.",
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getSelectedUser()
  return (
    <html lang="en">
      <body>
        <GateProvider>
          <UsersProvider user={user}>
            <SiteHeader selected={user} />
            {children}
          </UsersProvider>
        </GateProvider>
      </body>
    </html>
  )
}
