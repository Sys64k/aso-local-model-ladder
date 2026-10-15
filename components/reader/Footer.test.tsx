import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "@/lib/version";
import { Footer } from "./Footer";

describe("Footer", () => {
  it("renders a contentinfo landmark", () => {
    render(<Footer />);
    expect(screen.getByRole("contentinfo")).toHaveTextContent("ReadAloud");
  });

  it("shows the given version with a v prefix", () => {
    render(<Footer version="1.2.3" />);
    expect(screen.getByTestId("app-version")).toHaveTextContent("v1.2.3");
    expect(screen.getByRole("contentinfo")).toHaveTextContent("ReadAloud v1.2.3");
  });

  it("defaults to APP_VERSION, which is 'dev' in tests", () => {
    expect(APP_VERSION).toBe("dev");
    render(<Footer />);
    expect(screen.getByTestId("app-version").textContent).toBe("dev");
    expect(screen.getByRole("contentinfo")).toHaveTextContent("ReadAloud dev");
  });
});
