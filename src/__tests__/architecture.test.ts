import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { describe, expect, test } from "vitest"

const SOURCE_ROOT = resolve(import.meta.dirname, "..")

/**
 * Source units from the lowest layer to the highest. A unit can import from itself and from units
 * in lower layers. Units in the same layer cannot import each other.
 */
const LAYERS: ReadonlyArray<readonly string[]> = [
  ["lib/types"],
  ["lib/shared"],
  ["lib/gate", "lib/promise-cache"],
  ["lib/config"],
  ["lib/evaluation/stages"],
  ["lib/evaluation"],
  ["decision.ts", "factory.ts", "hooks", "integrations"],
  ["index.ts"],
]

const UNITS = LAYERS.flat().toSorted((left, right) => right.length - left.length)

function unitOf(path: string): string {
  const unit = UNITS.find((candidate) => path === candidate || path.startsWith(`${candidate}/`))
  if (!unit) {
    throw new Error(`${path} is not part of a layer`)
  }
  return unit
}

function layerOf(unit: string): number {
  return LAYERS.findIndex((layer) => layer.includes(unit))
}

function resolveImport(fromPath: string, specifier: string): string {
  const target = specifier.startsWith("#")
    ? specifier.slice(1)
    : relative(SOURCE_ROOT, join(dirname(join(SOURCE_ROOT, fromPath)), specifier))
  return UNITS.includes(`${target}.ts`) ? `${target}.ts` : target
}

function readSpecifiers(path: string): string[] {
  const source = readFileSync(join(SOURCE_ROOT, path), "utf8")
  return [...source.matchAll(/from "([.#][^"]+)"/g)].flatMap((match) => match[1] ?? [])
}

const sourceFiles = readdirSync(SOURCE_ROOT, { encoding: "utf8", recursive: true }).filter(
  (path) => /\.tsx?$/.test(path) && !path.includes("__tests__/")
)

describe("architecture", () => {
  test.each(sourceFiles)("%s imports only from lower layers", (path) => {
    const unit = unitOf(path)

    const violations = readSpecifiers(path).filter((specifier) => {
      const targetUnit = unitOf(resolveImport(path, specifier))
      return targetUnit !== unit && layerOf(targetUnit) >= layerOf(unit)
    })

    expect(violations).toEqual([])
  })

  test.each(sourceFiles)("%s uses subpath imports for lib modules outside its folder", (path) => {
    const relativeIntoLib = readSpecifiers(path).filter((specifier) => {
      if (!specifier.startsWith(".")) {
        return false
      }
      const target = resolveImport(path, specifier)
      return target.startsWith("lib/") && dirname(target) !== dirname(path)
    })

    expect(relativeIntoLib).toEqual([])
  })
})
