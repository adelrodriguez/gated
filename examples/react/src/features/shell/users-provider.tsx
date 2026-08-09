"use client"

import { createContext, useContext } from "react"
import type { SelectedUser } from "#shared/flags"

const UsersContext = createContext<SelectedUser>("alice")

export function UsersProvider({
  user,
  children,
}: {
  user: SelectedUser
  children: React.ReactNode
}) {
  return <UsersContext value={user}>{children}</UsersContext>
}

export function useSelectedUser(): SelectedUser {
  return useContext(UsersContext)
}
