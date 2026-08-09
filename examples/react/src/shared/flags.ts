export const USERS = ["alice", "bob", "carol"] as const
export type UserId = (typeof USERS)[number]
export type SelectedUser = UserId | "anonymous"
export type DemoIdentity = { distinctId: UserId }

export const BOOLEAN_KEYS = ["new-dashboard", "beta-banner", "flaky-flag"] as const
export const VARIANT_KEYS = ["checkout-theme", "pricing-experiment"] as const
export const FLAG_KEYS = [...BOOLEAN_KEYS, ...VARIANT_KEYS] as const
export type FlagKey = (typeof FLAG_KEYS)[number]

export const CHECKOUT_VARIANTS = ["light", "dark", "system"] as const
export const PRICING_VARIANTS = ["control", "a", "b"] as const

export const USER_COOKIE = "gated-demo-user"

export function isSelectedUser(value: string | undefined): value is SelectedUser {
  return value === "anonymous" || USERS.some((user) => user === value)
}
