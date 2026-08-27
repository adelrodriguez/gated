import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import packageJson from "../package.json" with { type: "json" }

const packageRoot = join(import.meta.dirname, "..")
const temporaryDirectory = mkdtempSync(join(tmpdir(), "gated-build-"))
const expectedFiles = Object.values(packageJson.exports).flatMap((entrypoint) => [
  entrypoint.import,
  entrypoint.types,
])

function run(command: string, arguments_: string[], cwd: string): void {
  execFileSync(command, arguments_, { cwd, stdio: "inherit" })
}

try {
  for (const relativePath of expectedFiles) {
    if (!existsSync(join(packageRoot, relativePath))) {
      throw new Error(`The package export does not exist: ${relativePath}`)
    }
  }

  run("npm", ["pack", "--pack-destination", temporaryDirectory], packageRoot)

  const tarballs = readdirSync(temporaryDirectory).filter((file) => file.endsWith(".tgz"))
  const [tarball] = tarballs
  if (!tarball || tarballs.length !== 1) {
    throw new Error(`Expected one package tarball, found ${tarballs.length}`)
  }

  const tarballPath = join(temporaryDirectory, tarball)
  writeFileSync(
    join(temporaryDirectory, "package.json"),
    `${JSON.stringify({ name: "gated-build-verification", private: true, type: "module" }, null, 2)}\n`
  )
  run(
    "npm",
    ["install", "--ignore-scripts", "--no-package-lock", "--omit=peer", tarballPath],
    temporaryDirectory
  )

  writeFileSync(
    join(temporaryDirectory, "core.mjs"),
    `import assert from "node:assert/strict"
import { buildGate, decision } from "gated"
import { defineHook } from "gated/hooks"

const factory = buildGate({
  decide: () => decision.boolean(true),
  identify: () => ({ distinctId: "consumer" }),
})

assert.equal(await factory({ defaultValue: false, key: "beta" })(), true)
assert.deepEqual(defineHook({}), {})
`
  )
  run(process.execPath, ["core.mjs"], temporaryDirectory)

  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-package-lock",
      `react@${packageJson.devDependencies.react}`,
      `@types/react@${packageJson.devDependencies["@types/react"]}`,
    ],
    temporaryDirectory
  )

  writeFileSync(
    join(temporaryDirectory, "react.mjs"),
    `import assert from "node:assert/strict"
import * as react from "gated/react"

assert.deepEqual(Object.keys(react).toSorted(), [
  "FeatureGate",
  "GateProvider",
  "createGateCache",
  "useGate",
  "useGateBatch",
  "useGateCache",
].toSorted())
`
  )
  run(process.execPath, ["react.mjs"], temporaryDirectory)

  writeFileSync(
    join(temporaryDirectory, "consumer.ts"),
    `import { buildGate, decision, type EvaluationDetails } from "gated"
import { defineHook } from "gated/hooks"
import { createGateCache, type GateValueOf, type ReactGateCache } from "gated/react"

const factory = buildGate({
  decide: () => decision.boolean(true),
  identify: () => ({ distinctId: "consumer" }),
})
const evaluator = factory({ defaultValue: false, key: "beta" })
const value: GateValueOf<typeof evaluator> = true
const details: EvaluationDetails<boolean> = {
  flagKey: "beta",
  source: "provider",
  value,
}
const cache: ReactGateCache = createGateCache()

defineHook({})
void cache
void details
`
  )
  writeFileSync(
    join(temporaryDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          target: "ESNext",
        },
        files: ["consumer.ts"],
      },
      null,
      2
    )}\n`
  )
  run(
    process.execPath,
    [join(packageRoot, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"],
    temporaryDirectory
  )

  console.info("Verified the packed Gated runtime and declarations.")
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true })
}
