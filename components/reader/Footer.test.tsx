import { vi, describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { APP_VERSION } from "@/lib/version";
import { Footer } from "./Footer";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

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

  it("shows 'Online' when the /api/health fetch succeeds", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    render(<Footer />);
    await waitFor(() => expect(screen.getByText(/Online/)).toBeInTheDocument());
  });

  it("shows 'Offline' when the /api/health fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("Failed fetch"));
    render(<Footer />);
    await waitFor(() => expect(screen.getByText(/Offline/)).toBeInTheDocument());
  });
});