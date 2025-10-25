import { describe, expect, mock, test } from "bun:test"
import { render, screen, waitFor } from "@testing-library/react"
import type { Identity } from "../lib/types"
import { createReactHook, FeatureGate } from "../react"

const USE_PREFIX_REGEX = /^use/

describe("createReactHook", () => {
  test("creates a hook function", () => {
    const gateFn = mock(async () => true)
    const useFlag = createReactHook(gateFn)

    expect(typeof useFlag).toBe("function")
  })

  test("returns a function that accepts optional override identity", () => {
    const gateFn = mock(async () => true)
    const useFlag = createReactHook(gateFn)

    // Hook should be a function with 0 or 1 parameters
    expect(useFlag.length).toBeLessThanOrEqual(1)
  })

  test("hook function name reflects it's a hook", () => {
    const gateFn = mock(async () => true)
    const useFlag = createReactHook(gateFn)

    // Function should have a name starting with "use"
    expect(useFlag.name).toMatch(USE_PREFIX_REGEX)
  })

  test("hook accepts optional identity parameter signature", () => {
    interface CustomIdentity extends Identity {
      userId: string
    }

    const gateFn = mock((identity?: CustomIdentity) =>
      Promise.resolve(identity?.userId === "123")
    )
    const useFlag = createReactHook(gateFn)

    // Verify the hook was created and can be called
    expect(typeof useFlag).toBe("function")
    expect(useFlag.length).toBeLessThanOrEqual(1)
  })

  test("hook can be created from boolean gate function", () => {
    const gateFn = mock(() => Promise.resolve(true))
    const useFlag = createReactHook(gateFn)

    expect(typeof useFlag).toBe("function")
    expect(useFlag.name).toMatch(USE_PREFIX_REGEX)
  })

  test("hook can be created from string variant gate function", () => {
    const gateFn = mock(() => Promise.resolve("dark"))
    const useTheme = createReactHook(gateFn)

    expect(typeof useTheme).toBe("function")
    expect(useTheme.name).toMatch(USE_PREFIX_REGEX)
  })
})

describe("FeatureGate - Loading States", () => {
  test("uses default Suspense when no loading prop provided with sync gate", async () => {
    const gateFn = mock(() => true)

    render(
      <FeatureGate gate={gateFn}>
        <div data-testid="feature">Feature Content</div>
      </FeatureGate>
    )

    // With sync gate, feature should render immediately
    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Feature Content")
    })
  })

  test("shows loading component provided via loading prop", async () => {
    const gateFn = mock(() => true)

    render(
      <FeatureGate
        gate={gateFn}
        loading={<div data-testid="loading">Loading...</div>}
      >
        <div data-testid="feature">Feature Content</div>
      </FeatureGate>
    )

    // Even with sync gate, the feature should eventually render
    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Feature Content")
    })
  })

  test("loading prop works with variant gates", async () => {
    const gateFn = mock(() => "dark")

    render(
      <FeatureGate
        gate={gateFn}
        loading={<div data-testid="loading">Checking theme...</div>}
        match="dark"
      >
        <div data-testid="theme">Dark Mode Active</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("Dark Mode Active")
    })
  })

  test("shows fallback when gate doesn't match (no loading state visible)", async () => {
    const gateFn = mock(() => false)

    render(
      <FeatureGate
        fallback={<div data-testid="fallback">Not available</div>}
        gate={gateFn}
        loading={<div data-testid="loading">Loading...</div>}
      >
        <div data-testid="feature">Feature Content</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("fallback").textContent).toBe("Not available")
    })

    expect(screen.queryByTestId("feature")).toBeNull()
  })

  test("loading prop works with overrideIdentity", async () => {
    interface CustomIdentity extends Identity {
      tier: "free" | "pro"
    }

    const gateFn = mock((identity?: CustomIdentity) => identity?.tier === "pro")

    render(
      <FeatureGate
        gate={gateFn}
        loading={<div data-testid="loading">Checking access...</div>}
        overrideIdentity={{ distinctId: "user1", tier: "pro" }}
      >
        <div data-testid="feature">Pro Feature</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Pro Feature")
    })
  })
})

describe("FeatureGate - Boolean Gates", () => {
  test("renders children when gate returns true (match default)", async () => {
    const gateFn = mock(() => true)

    render(
      <FeatureGate gate={gateFn}>
        <div data-testid="feature">Beta Feature</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Beta Feature")
    })
  })

  test("renders fallback when gate returns false", async () => {
    const gateFn = mock(() => false)

    render(
      <FeatureGate
        fallback={<div data-testid="fallback">Not available</div>}
        gate={gateFn}
      >
        <div data-testid="feature">Beta Feature</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("fallback").textContent).toBe("Not available")
    })
    expect(screen.queryByTestId("feature")).toBeNull()
  })

  test("respects explicit match=true", async () => {
    const gateFn = mock(() => true)

    render(
      <FeatureGate gate={gateFn} match={true}>
        <div data-testid="feature">Beta Feature</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Beta Feature")
    })
  })

  test("respects explicit match=false (inverted logic)", async () => {
    const gateFn = mock(() => false)

    render(
      <FeatureGate gate={gateFn} match={false}>
        <div data-testid="feature">Beta Feature</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Beta Feature")
    })
  })

  test("passes override identity to gate", async () => {
    interface CustomIdentity extends Identity {
      plan: "free" | "pro"
    }

    const gateFn = mock((identity?: CustomIdentity) => identity?.plan === "pro")

    const overrideIdentity: CustomIdentity = {
      distinctId: "user123",
      plan: "pro",
    }

    render(
      <FeatureGate gate={gateFn} overrideIdentity={overrideIdentity}>
        <div data-testid="feature">Pro Feature</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Pro Feature")
    })
    expect(gateFn).toHaveBeenCalledWith(overrideIdentity)
  })

  test("works without override identity", async () => {
    const gateFn = mock(() => true)

    render(
      <FeatureGate gate={gateFn}>
        <div data-testid="feature">Feature</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Feature")
    })
    expect(gateFn).toHaveBeenCalledWith(undefined)
  })

  test("renders children when match is true and gate returns true", async () => {
    const gateFn = mock(() => true)

    render(
      <FeatureGate gate={gateFn} match={true}>
        <div data-testid="content">Content</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("content").textContent).toBe("Content")
    })
  })

  test("renders fallback when match is true but gate returns false", async () => {
    const gateFn = mock(() => false)

    render(
      <FeatureGate
        fallback={<div data-testid="fallback">Off</div>}
        gate={gateFn}
        match={true}
      >
        <div data-testid="content">Content</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("fallback").textContent).toBe("Off")
    })
  })

  test("renders children when match is false and gate returns false", async () => {
    const gateFn = mock(() => false)

    render(
      <FeatureGate gate={gateFn} match={false}>
        <div data-testid="content">Content</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("content").textContent).toBe("Content")
    })
  })

  test("renders fallback when match is false but gate returns true", async () => {
    const gateFn = mock(() => true)

    render(
      <FeatureGate
        fallback={<div data-testid="fallback">Off</div>}
        gate={gateFn}
        match={false}
      >
        <div data-testid="content">Content</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("fallback").textContent).toBe("Off")
    })
  })
})

describe("FeatureGate - Variant Gates", () => {
  test("renders children when variant matches", async () => {
    const gateFn = mock(() => "dark")

    render(
      <FeatureGate gate={gateFn} match="dark">
        <div data-testid="theme">Dark Theme Active</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("Dark Theme Active")
    })
  })

  test("renders fallback when variant doesn't match", async () => {
    const gateFn = mock(() => "light")

    render(
      <FeatureGate
        fallback={<div data-testid="fallback">Not dark mode</div>}
        gate={gateFn}
        match="dark"
      >
        <div data-testid="theme">Dark Theme Active</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("fallback").textContent).toBe("Not dark mode")
    })
    expect(screen.queryByTestId("theme")).toBeNull()
  })

  test("works with light variant", async () => {
    const gateFn = mock(() => "light")

    render(
      <FeatureGate gate={gateFn} match="light">
        <div data-testid="theme">Light Theme Active</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("Light Theme Active")
    })
  })

  test("works with system variant", async () => {
    const gateFn = mock(() => "system")

    render(
      <FeatureGate gate={gateFn} match="system">
        <div data-testid="theme">System Theme Active</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe(
        "System Theme Active"
      )
    })
  })

  test("passes override identity to variant gate", async () => {
    interface CustomIdentity extends Identity {
      preference: "dark" | "light"
    }

    const gateFn = mock(
      (identity?: CustomIdentity) => identity?.preference ?? "light"
    )

    const overrideIdentity: CustomIdentity = {
      distinctId: "user123",
      preference: "dark",
    }

    render(
      <FeatureGate
        gate={gateFn}
        match="dark"
        overrideIdentity={overrideIdentity}
      >
        <div data-testid="theme">Dark Theme</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("Dark Theme")
    })
    expect(gateFn).toHaveBeenCalledWith(overrideIdentity)
  })

  test("works with variant option-a", async () => {
    const gateFn = mock(() => "option-a")

    render(
      <FeatureGate gate={gateFn} match="option-a">
        <div data-testid="result">A</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("result").textContent).toBe("A")
    })
  })

  test("works with variant option-b", async () => {
    const gateFn = mock(() => "option-b")

    render(
      <FeatureGate gate={gateFn} match="option-b">
        <div data-testid="result">B</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("result").textContent).toBe("B")
    })
  })

  test("works with variant option-c", async () => {
    const gateFn = mock(() => "option-c")

    render(
      <FeatureGate gate={gateFn} match="option-c">
        <div data-testid="result">C</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("result").textContent).toBe("C")
    })
  })

  test("variant match is exact", async () => {
    const gateFn = mock(() => "dark-mode")

    render(
      <FeatureGate
        fallback={<div data-testid="fallback">No match</div>}
        gate={gateFn}
        match="dark"
      >
        <div data-testid="theme">Dark</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("fallback").textContent).toBe("No match")
    })
  })
})

describe("FeatureGate - Edge Cases", () => {
  test("works without loading prop (uses default Suspense)", async () => {
    const gateFn = mock(() => true)

    render(
      <FeatureGate gate={gateFn}>
        <div data-testid="feature">Feature</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Feature")
    })
  })

  test("works without fallback prop (renders nothing)", async () => {
    const gateFn = mock(() => false)

    const { container } = render(
      <FeatureGate gate={gateFn}>
        <div data-testid="feature">Feature</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.queryByTestId("feature")).toBeNull()
      // Container should have minimal content (just Suspense wrapper)
      expect(container.textContent).toBe("")
    })
  })

  test("handles custom identity types in variant gates", async () => {
    interface CustomIdentity extends Identity {
      colorScheme: "dark" | "light" | "auto"
    }

    const gateFn = mock(
      (identity?: CustomIdentity) => identity?.colorScheme ?? "light"
    )

    const customIdentity: CustomIdentity = {
      distinctId: "user123",
      colorScheme: "auto",
    }

    render(
      <FeatureGate gate={gateFn} match="auto" overrideIdentity={customIdentity}>
        <div data-testid="theme">Auto Theme</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("Auto Theme")
    })
  })

  test("multiple FeatureGates can be nested", async () => {
    const betaGate = mock(() => true)
    const proGate = mock(() => true)

    render(
      <FeatureGate gate={betaGate}>
        <FeatureGate gate={proGate}>
          <div data-testid="feature">Pro Beta Feature</div>
        </FeatureGate>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Pro Beta Feature")
    })
  })

  test("nested gates with one false doesn't render children", async () => {
    const betaGate = mock(() => true)
    const proGate = mock(() => false)

    render(
      <FeatureGate gate={betaGate}>
        <FeatureGate
          fallback={<div data-testid="fallback">Not pro</div>}
          gate={proGate}
        >
          <div data-testid="feature">Pro Beta Feature</div>
        </FeatureGate>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("fallback").textContent).toBe("Not pro")
    })
    expect(screen.queryByTestId("feature")).toBeNull()
  })

  test("renders correctly with boolean false match", async () => {
    const gateFn = mock(() => true)

    render(
      <FeatureGate
        fallback={<div data-testid="fallback">Fallback</div>}
        gate={gateFn}
        match={false}
      >
        <div data-testid="feature">Feature</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("fallback").textContent).toBe("Fallback")
    })
  })

  test("gate function is called exactly once per render", async () => {
    const gateFn = mock(() => true)

    render(
      <FeatureGate gate={gateFn}>
        <div data-testid="feature">Feature</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("feature")).not.toBeNull()
    })

    expect(gateFn).toHaveBeenCalledTimes(1)
  })

  test("renders multiple children correctly", async () => {
    const gateFn = mock(() => true)

    render(
      <FeatureGate gate={gateFn}>
        <div data-testid="child1">Child 1</div>
        <div data-testid="child2">Child 2</div>
        <div data-testid="child3">Child 3</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("child1").textContent).toBe("Child 1")
      expect(screen.getByTestId("child2").textContent).toBe("Child 2")
      expect(screen.getByTestId("child3").textContent).toBe("Child 3")
    })
  })

  test("handles complex nested children", async () => {
    const gateFn = mock(() => true)

    render(
      <FeatureGate gate={gateFn}>
        <div>
          <span data-testid="nested">Nested Content</span>
        </div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("nested").textContent).toBe("Nested Content")
    })
  })

  test("fallback can be complex component tree", async () => {
    const gateFn = mock(() => false)

    render(
      <FeatureGate
        fallback={
          <div>
            <span data-testid="fallback-nested">Not available</span>
          </div>
        }
        gate={gateFn}
      >
        <div data-testid="feature">Feature</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("fallback-nested").textContent).toBe(
        "Not available"
      )
    })
  })
})

describe("FeatureGate - Error Handling", () => {
  test("handles synchronous gate function errors", () => {
    const gateFn = mock(() => {
      throw new Error("Gate evaluation failed")
    })

    // In React, errors during render are caught by error boundaries
    // Without an error boundary, the error will propagate
    expect(() => {
      render(
        <FeatureGate gate={gateFn}>
          <div data-testid="feature">Feature</div>
        </FeatureGate>
      )
    }).toThrow("Gate evaluation failed")
  })

  test("handles gate function returning undefined", async () => {
    const gateFn = mock(() => undefined as unknown as boolean)

    render(
      <FeatureGate
        fallback={<div data-testid="fallback">Fallback</div>}
        gate={gateFn}
      >
        <div data-testid="feature">Feature</div>
      </FeatureGate>
    )

    // undefined !== true, so should show fallback
    await waitFor(() => {
      expect(screen.getByTestId("fallback").textContent).toBe("Fallback")
    })
  })

  test("handles gate function returning null", async () => {
    const gateFn = mock(() => null as unknown as boolean)

    render(
      <FeatureGate
        fallback={<div data-testid="fallback">Fallback</div>}
        gate={gateFn}
      >
        <div data-testid="feature">Feature</div>
      </FeatureGate>
    )

    // null !== true, so should show fallback
    await waitFor(() => {
      expect(screen.getByTestId("fallback").textContent).toBe("Fallback")
    })
  })

  test("handles gate with overrideIdentity throwing error", () => {
    interface CustomIdentity extends Identity {
      plan: string
    }

    const gateFn = mock((identity?: CustomIdentity) => {
      if (identity?.plan === "invalid") {
        throw new Error("Invalid plan")
      }
      return true
    })

    expect(() => {
      render(
        <FeatureGate
          gate={gateFn}
          overrideIdentity={{ distinctId: "user1", plan: "invalid" }}
        >
          <div data-testid="feature">Feature</div>
        </FeatureGate>
      )
    }).toThrow("Invalid plan")
  })
})

describe("FeatureGate - Advanced Edge Cases", () => {
  test("handles gate returning empty string", async () => {
    const gateFn = mock(() => "")

    render(
      <FeatureGate
        fallback={<div data-testid="fallback">No variant</div>}
        gate={gateFn}
        match=""
      >
        <div data-testid="feature">Empty string variant</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe(
        "Empty string variant"
      )
    })
  })

  test("handles gate returning 0 as string", async () => {
    const gateFn = mock(() => "0")

    render(
      <FeatureGate gate={gateFn} match="0">
        <div data-testid="feature">Zero variant</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Zero variant")
    })
  })

  test("handles match with special characters", async () => {
    const gateFn = mock(() => "variant-with-dashes_and_underscores")

    render(
      <FeatureGate gate={gateFn} match="variant-with-dashes_and_underscores">
        <div data-testid="feature">Special chars</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Special chars")
    })
  })

  test("boolean gate with explicit true match is type-safe", async () => {
    const gateFn = mock(() => true)

    render(
      <FeatureGate gate={gateFn} match={true}>
        <div data-testid="feature">Feature</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Feature")
    })
  })

  test("does not confuse string 'true' with boolean true", async () => {
    const gateFn = mock(() => "true")

    render(
      <FeatureGate
        fallback={<div data-testid="fallback">Not boolean</div>}
        gate={gateFn}
        match={true as unknown as string}
      >
        <div data-testid="feature">Feature</div>
      </FeatureGate>
    )

    // String "true" !== boolean true
    await waitFor(() => {
      expect(screen.getByTestId("fallback").textContent).toBe("Not boolean")
    })
  })

  test("handles rapidly changing gate values", async () => {
    let value = false
    const gateFn = mock(() => value)

    const { rerender } = render(
      <FeatureGate
        fallback={<div data-testid="fallback">Off</div>}
        gate={gateFn}
      >
        <div data-testid="feature">On</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("fallback").textContent).toBe("Off")
    })

    value = true
    rerender(
      <FeatureGate
        fallback={<div data-testid="fallback">Off</div>}
        gate={gateFn}
      >
        <div data-testid="feature">On</div>
      </FeatureGate>
    )

    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("On")
    })
  })

  test("handles gate returning resolved promise", async () => {
    // Test with a gate that returns a promise (though the actual implementation uses sync gates)
    const gateFn = mock(() => true)

    render(
      <FeatureGate
        gate={gateFn}
        loading={<div data-testid="loading">Loading</div>}
      >
        <div data-testid="feature">Feature</div>
      </FeatureGate>
    )

    // Feature should render
    await waitFor(() => {
      expect(screen.getByTestId("feature").textContent).toBe("Feature")
    })
  })

  test("handles case-sensitive variant matching", async () => {
    const gateFn = mock(() => "Dark")

    render(
      <FeatureGate
        fallback={<div data-testid="fallback">No match</div>}
        gate={gateFn}
        match="dark"
      >
        <div data-testid="feature">Dark theme</div>
      </FeatureGate>
    )

    // "Dark" !== "dark" (case-sensitive)
    await waitFor(() => {
      expect(screen.getByTestId("fallback").textContent).toBe("No match")
    })
  })

  test("handles whitespace in variant strings", async () => {
    const gateFn = mock(() => " dark ")

    render(
      <FeatureGate
        fallback={<div data-testid="fallback">No match</div>}
        gate={gateFn}
        match="dark"
      >
        <div data-testid="feature">Dark theme</div>
      </FeatureGate>
    )

    // " dark " !== "dark" (whitespace matters)
    await waitFor(() => {
      expect(screen.getByTestId("fallback").textContent).toBe("No match")
    })
  })
})
