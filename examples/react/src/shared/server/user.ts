import "server-only"

import { cookies } from "next/headers"
import { isSelectedUser, USER_COOKIE, type DemoIdentity, type SelectedUser } from "#shared/flags"

export async function getSelectedUser(): Promise<SelectedUser> {
  const value = (await cookies()).get(USER_COOKIE)?.value
  return isSelectedUser(value) ? value : "alice"
}

export async function getIdentity(): Promise<DemoIdentity | null> {
  const user = await getSelectedUser()
  return user === "anonymous" ? null : { distinctId: user }
}
