import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useTheme } from "./theme";
import { ThemeSwitch } from "./ThemeSwitch";

// A fake OS colour-scheme setting that the test can flip.
let osDark = false;
const listeners = new Set<() => void>();
function setOs(dark: boolean) {
  osDark = dark;
  listeners.forEach((l) => l());
}

function Harness() {
  const { mode, theme, setMode } = useTheme();
  return (
    <>
      <ThemeSwitch id="t" mode={mode} setMode={setMode} />
      <output>{`${mode}:${theme}`}</output>
    </>
  );
}

beforeEach(() => {
  osDark = false;
  listeners.clear();
  localStorage.clear();
  document.documentElement.className = "";
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() {
      return q.includes("dark") ? osDark : false;
    },
    media: q,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const shown = () => screen.getByRole("status").textContent;

describe("theme", () => {
  it("defaults to system and follows the OS as it changes", () => {
    render(<Harness />);
    expect(shown()).toBe("system:light");
    expect(screen.getByRole("radio", { name: "System theme" })).toHaveAttribute("aria-checked", "true");
    act(() => setOs(true));
    expect(shown()).toBe("system:dark");
    expect(document.documentElement).toHaveClass("dark");
  });

  it("a chosen theme overrides the OS and is remembered; system clears the choice", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("radio", { name: "Dark theme" }));
    expect(shown()).toBe("dark:dark");
    expect(localStorage.getItem("oneshot-theme")).toBe("dark");
    act(() => setOs(false));
    expect(shown()).toBe("dark:dark");
    await user.click(screen.getByRole("radio", { name: "System theme" }));
    expect(shown()).toBe("system:light");
    expect(localStorage.getItem("oneshot-theme")).toBeNull();
  });

  it("moves the choice with the arrow keys, like any radio group", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole("radio", { name: "System theme" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(shown()).toBe("light:light");
    expect(screen.getByRole("radio", { name: "Light theme" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(shown()).toBe("dark:dark");
  });
});
