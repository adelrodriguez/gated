"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { isSelectedUser, USER_COOKIE } from "#shared/flags"

export async function switchUser(formData: FormData): Promise<void> {
  const value = String(formData.get("user"))
  if (!isSelectedUser(value)) return
  ;(await cookies()).set(USER_COOKIE, value, { httpOnly: true, path: "/", sameSite: "lax" })
  revalidatePath("/", "layout")
}
