import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "@/app/page";

describe("smoke", () => {
  it("renders the placeholder page heading", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", { level: 1, name: "ReadAloud" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });
});
