import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { COLUMNS, Wire, columnOf } from "./Wire";
import { STATUSES } from "@/lib/api";
import { action } from "@/test/fixtures";

describe("Wire", () => {
  it("puts every status in exactly one column", () => {
    for (const s of STATUSES) expect(COLUMNS.filter((c) => c.statuses.includes(s))).toHaveLength(1);
    expect(columnOf("UNKNOWN")).toBe("human");
    expect(columnOf("FAILED")).toBe("settled");
  });

  it("shows each action as a link in its column, with counts", () => {
    render(
      <MemoryRouter>
        <Wire actions={[action({ id: "act_aaaaaa111111", status: "IN_FLIGHT" }), action({ id: "act_bbbbbb222222", status: "UNKNOWN" })]} />
      </MemoryRouter>,
    );
    const wire = screen.getByRole("region", { name: "On the wire" });
    expect(wire).toHaveTextContent("111111");
    expect(screen.getByRole("region", { name: "Needs a human" })).toHaveTextContent("222222");
    expect(screen.getByRole("region", { name: "Accepted" })).toHaveTextContent("Nothing here");
    expect(screen.getByRole("link", { name: /111111/ })).toHaveAttribute("href", "/actions/act_aaaaaa111111");
  });
});
