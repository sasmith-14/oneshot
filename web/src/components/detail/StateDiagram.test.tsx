import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { EDGES, StateDiagram, pathTaken } from "./StateDiagram";
import { ev } from "@/test/fixtures";

describe("StateDiagram", () => {
  it("draws exactly the transitions oneshot/domain.py allows", () => {
    // ALLOWED_TRANSITIONS, minus the VERIFYING self-loop, which is drawn separately.
    const allowed = [
      "PENDING>IN_FLIGHT",
      "IN_FLIGHT>SUCCEEDED", "IN_FLIGHT>FAILED", "IN_FLIGHT>PENDING", "IN_FLIGHT>VERIFYING", "IN_FLIGHT>UNKNOWN",
      "VERIFYING>SUCCEEDED", "VERIFYING>FAILED", "VERIFYING>PENDING", "VERIFYING>UNKNOWN",
      "UNKNOWN>SUCCEEDED", "UNKNOWN>FAILED",
    ];
    expect(EDGES.map((e) => `${e.from}>${e.to}`).sort()).toEqual(allowed.sort());
  });

  it("counts repeated transitions", () => {
    const { edges, visited } = pathTaken([ev(null, "PENDING"), ev("PENDING", "IN_FLIGHT"), ev("IN_FLIGHT", "PENDING"), ev("PENDING", "IN_FLIGHT")]);
    expect(edges.get("PENDING>IN_FLIGHT")).toBe(2);
    expect([...visited].sort()).toEqual(["IN_FLIGHT", "PENDING"]);
  });

  it("labels the current state for screen readers", () => {
    const { getByRole } = render(<StateDiagram status="UNKNOWN" events={[]} />);
    expect(getByRole("img")).toHaveAccessibleName("Lifecycle diagram, current state UNKNOWN");
  });
});
