import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "@/app/page";

describe("smoke", () => {
  it("renders the ReadAloud home screen", () => {
    render(<Home />);
    expect(screen.getByRole("banner")).toHaveTextContent("ReadAloud");
    expect(
      screen.getByRole("heading", { level: 1, name: "What would you like to read?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });
});
