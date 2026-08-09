"use server"

import { revalidatePath } from "next/cache"
import { resetStore, setFlakyKnobs, setGlobalValue, setOverride } from "#shared/demo-provider/store"
import {
  BOOLEAN_KEYS,
  CHECKOUT_VARIANTS,
  FLAG_KEYS,
  PRICING_VARIANTS,
  USERS,
  type FlagKey,
  type UserId,
} from "#shared/flags"

function flagKey(value: FormDataEntryValue | null): FlagKey | null {
  const key = String(value)
  return FLAG_KEYS.some((candidate) => candidate === key) ? (key as FlagKey) : null
}

function userId(value: FormDataEntryValue | null): UserId | null {
  const user = String(value)
  return USERS.some((candidate) => candidate === user) ? (user as UserId) : null
}

export async function updateGlobal(formData: FormData): Promise<void> {
  const key = flagKey(formData.get("key"))
  if (!key) return
  const raw = String(formData.get("value"))
  const value = BOOLEAN_KEYS.some((candidate) => candidate === key) ? raw === "true" : raw
  const allowed =
    key === "checkout-theme"
      ? CHECKOUT_VARIANTS
      : key === "pricing-experiment"
        ? PRICING_VARIANTS
        : null
  if (allowed && !allowed.some((candidate) => candidate === value)) return
  setGlobalValue(key, value)
  revalidatePath("/admin")
}

export async function updateOverride(formData: FormData): Promise<void> {
  const key = flagKey(formData.get("key"))
  const user = userId(formData.get("user"))
  if (!key || !user) return
  const raw = String(formData.get("value"))
  if (raw === "inherit") setOverride(key, user, null)
  else if (BOOLEAN_KEYS.some((candidate) => candidate === key))
    setOverride(key, user, raw === "true")
  else setOverride(key, user, raw)
  revalidatePath("/admin")
}

export async function updateFlaky(formData: FormData): Promise<void> {
  const latency = Number(formData.get("latencyMs"))
  setFlakyKnobs(Number.isFinite(latency) ? latency : 0, formData.get("fail") === "on")
  revalidatePath("/admin")
}

export async function resetDemo(): Promise<void> {
  resetStore()
  revalidatePath("/admin")
}
