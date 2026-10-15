import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listDocuments, saveDocument, updateProgress } from "@/lib/documents";
import { SETTINGS_STORAGE_KEY } from "@/lib/settings";
import { fakeVoice, installFakeSpeech } from "@/tests/fakes/speechSynthesis";
import { ReaderApp, SAMPLE_SENTENCE } from "./ReaderApp";

vi.mock("@/lib/import/ocr", () => ({ recognizeImage: vi.fn() }));
vi.mock("@/lib/import/pdf", () => ({ extractPdfText: vi.fn() }));

const TEXT = "First sentence here. Second one follows. Third is last.";
const SENTENCES = ["First sentence here.", "Second one follows.", "Third is last."];

let installed: ReturnType<typeof installFakeSpeech>;
let restored = false;

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  installed = installFakeSpeech();
  restored = false;
});

afterEach(() => {
  if (!restored) installed.restore();
  vi.restoreAllMocks();
});

function restoreSpeech() {
  installed.restore();
  restored = true;
}

function setup() {
  const user = userEvent.setup();
  const utils = render(<ReaderApp />);
  return { user, ...utils };
}

async function importText(user: ReturnType<typeof userEvent.setup>, text = TEXT) {
  const textarea = screen.getByLabelText("Text to read");
  fireEvent.change(textarea, { target: { value: text } });
  await user.click(screen.getByRole("button", { name: "Read this text" }));
}

function sentence(i: number): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-sentence-index="${i}"]`);
  if (!el) throw new Error(`no sentence ${i}`);
  return el;
}

function currentSentences(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-current="true"]'));
}

function announcer(): string {
  return (document.getElementById("announcer")?.textContent ?? "").trim();
}

function readerRoot(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".reader-root");
  if (!el) throw new Error("no reader root");
  return el;
}

function expectNoSentenceInAnnouncer() {
  for (const s of SENTENCES) expect(announcer()).not.toContain(s);
}

describe("page structure", () => {
  it("has a skip link as the first focusable element, a header and a home screen", async () => {
    const { user } = setup();
    await user.tab();
    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute("href", "#main");

    const header = screen.getByRole("banner");
    expect(header).toHaveTextContent("ReadAloud");
    expect(within(header).getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Keyboard shortcuts" })).toBeInTheDocument();

    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    expect(
      screen.getByRole("heading", { level: 1, name: "What would you like to read?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Recent documents" })).toBeInTheDocument();
  });

  it("renders a single footer with the app version after main, on home and reader screens", async () => {
    const { user } = setup();
    const check = () => {
      const footers = screen.getAllByRole("contentinfo");
      expect(footers).toHaveLength(1);
      const footer = footers[0];
      expect(footer).toHaveTextContent("ReadAloud dev");
      expect(within(footer).getByTestId("app-version")).toHaveTextContent("dev");
      expect(screen.getByRole("main").nextElementSibling).toBe(footer);
    };
    check();
    await importText(user);
    check();
  });

  it("gives every button a minimum height of at least 48px", async () => {
    const { user } = setup();
    await importText(user);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(10);
    for (const b of buttons) {
      expect(b.className, b.textContent ?? "").toMatch(/\bmin-h-(1[2-9]|[2-9]\d)\b/);
    }
    // The playback buttons are larger (56px).
    for (const name of ["Play", "Stop", "Previous sentence", "Next sentence"]) {
      expect(screen.getByRole("button", { name, hidden: true }).className).toMatch(/\bmin-h-14\b/);
    }
  });
});

describe("import → reader", () => {
  it("saves the document, opens the reader and moves focus to the heading", async () => {
    const { user } = setup();
    await importText(user);
    const heading = screen.getByRole("heading", { level: 1, name: "First sentence here." });
    expect(heading).toHaveFocus();
    expect(listDocuments()).toHaveLength(1);
    expect(listDocuments()[0].text).toBe(TEXT);
    expect(screen.getByRole("region", { name: "Document text" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("Sentence 1 of 3")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
    SENTENCES.forEach((s, i) => expect(sentence(i)).toHaveTextContent(s));
  });

  it("goes back home with New document and moves focus to the home heading", async () => {
    const { user } = setup();
    await importText(user);
    await user.click(screen.getByRole("button", { name: "New document" }));
    const h1 = screen.getByRole("heading", { level: 1, name: "What would you like to read?" });
    expect(h1).toHaveFocus();
    expect(screen.getByRole("button", { name: /^First sentence here\./ })).toBeInTheDocument();
  });
});

describe("playback", () => {
  it("Play speaks the first sentence and highlights it; word highlight uses <mark>", async () => {
    const { user } = setup();
    const { fake } = installed;
    await importText(user);
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(fake.spokenTexts).toEqual([SENTENCES[0]]);
    expect(currentSentences()).toEqual([sentence(0)]);
    expect(sentence(0)).toHaveClass("sentence-highlight");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(announcer()).toBe("Playing");

    act(() => fake.fireBoundary(6, 8));
    const mark = sentence(0).querySelector("mark");
    expect(mark).toHaveTextContent("sentence");
    expect(sentence(0)).toHaveTextContent(SENTENCES[0]);
    expectNoSentenceInAnnouncer();
  });

  it("does not use <mark> when word highlighting is off", async () => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ highlightMode: "sentence" }));
    const { user } = setup();
    const { fake } = installed;
    await importText(user);
    await user.click(screen.getByRole("button", { name: "Play" }));
    act(() => fake.fireBoundary(6, 8));
    expect(document.querySelector("mark")).toBeNull();
    expect(sentence(0)).toHaveAttribute("aria-current", "true");
  });

  it("Next, Previous, Pause, Stop and finishing", async () => {
    const { user } = setup();
    const { fake } = installed;
    await importText(user);
    await user.click(screen.getByRole("button", { name: "Play" }));

    await user.click(screen.getByRole("button", { name: "Next sentence" }));
    expect(fake.lastSpoken?.text).toBe(SENTENCES[1]);
    expect(currentSentences()).toEqual([sentence(1)]);
    expect(screen.getByText("Sentence 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");

    await user.click(screen.getByRole("button", { name: "Previous sentence" }));
    expect(fake.lastSpoken?.text).toBe(SENTENCES[0]);
    expect(currentSentences()).toEqual([sentence(0)]);

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(announcer()).toBe("Paused");
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(announcer()).toBe("Playing");

    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(announcer()).toBe("Stopped");

    // Read to the end.
    await user.click(sentence(2));
    expect(announcer()).toBe("Playing");
    act(() => fake.finishCurrent());
    expect(announcer()).toBe("Finished reading");
    expectNoSentenceInAnnouncer();
  });

  it("follows the speech engine to the next sentence", async () => {
    const { user } = setup();
    const { fake } = installed;
    await importText(user);
    await user.click(screen.getByRole("button", { name: "Play" }));
    act(() => fake.finishCurrent());
    expect(currentSentences()).toEqual([sentence(1)]);
    expect(fake.lastSpoken?.text).toBe(SENTENCES[1]);
    expectNoSentenceInAnnouncer();
  });

  it("clicking a sentence starts reading from it", async () => {
    const { user } = setup();
    const { fake } = installed;
    await importText(user);
    await user.click(sentence(2));
    expect(fake.spokenTexts).toEqual([SENTENCES[2]]);
    expect(currentSentences()).toEqual([sentence(2)]);
  });

  it("Enter on the reader region reads from the current sentence", async () => {
    const { user } = setup();
    const { fake } = installed;
    await importText(user);
    screen.getByRole("region", { name: "Document text" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(currentSentences()).toEqual([sentence(1)]);
    expect(fake.spoken).toHaveLength(0);
    await user.keyboard("{Enter}");
    expect(fake.spokenTexts).toEqual([SENTENCES[1]]);
  });

  it("the toolbar speed slider changes the rate", async () => {
    const { user } = setup();
    const { fake } = installed;
    await importText(user);
    const slider = within(screen.getByRole("group", { name: "Playback" })).getByRole("slider", {
      name: "Reading speed",
    });
    expect(slider).toHaveAttribute("min", "0.5");
    expect(slider).toHaveAttribute("max", "2");
    expect(slider).toHaveAttribute("step", "0.1");
    expect(slider).toHaveAttribute("aria-valuetext", "1.0×");
    fireEvent.change(slider, { target: { value: "1.5" } });
    expect(slider).toHaveAttribute("aria-valuetext", "1.5×");
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(fake.lastSpoken?.rate).toBe(1.5);
  });

  it("keeps the current sentence in view when auto-scroll is on", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { user } = setup();
    await importText(user);
    await user.click(screen.getByRole("button", { name: "Next sentence" }));
    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    const el = scroll.mock.contexts[scroll.mock.contexts.length - 1];
    expect(el).toBe(sentence(1));

    // Reduced motion: no smooth scrolling.
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    await user.click(screen.getByRole("button", { name: "Next sentence" }));
    expect(scroll).toHaveBeenLastCalledWith({ block: "center", behavior: "auto" });
    delete (window as { matchMedia?: unknown }).matchMedia;
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("focus view shows the current sentence large with its neighbours", async () => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ viewMode: "focus" }));
    const { user } = setup();
    await importText(user);
    expect(readerRoot()).toHaveAttribute("data-view-mode", "focus");
    expect(document.querySelectorAll("[data-sentence-index]")).toHaveLength(2);
    expect(sentence(0)).toHaveClass("focus-current");
    expect(sentence(1)).toHaveClass("focus-context");
    await user.click(screen.getByRole("button", { name: "Next sentence" }));
    expect(document.querySelectorAll("[data-sentence-index]")).toHaveLength(3);
    expect(sentence(1)).toHaveClass("focus-current");
    expect(sentence(1)).toHaveAttribute("aria-current", "true");
  });
});

describe("keyboard shortcuts", () => {
  it("control playback, text size, speed, view, theme and help", async () => {
    const { user } = setup();
    const { fake } = installed;
    await importText(user);
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();

    await user.keyboard(" ");
    expect(fake.spokenTexts).toEqual([SENTENCES[0]]);
    expect(announcer()).toBe("Playing");
    await user.keyboard("k");
    expect(announcer()).toBe("Paused");
    await user.keyboard("K");
    expect(announcer()).toBe("Playing");

    await user.keyboard("{ArrowRight}");
    expect(currentSentences()).toEqual([sentence(1)]);
    await user.keyboard("l");
    expect(currentSentences()).toEqual([sentence(2)]);
    await user.keyboard("{ArrowLeft}");
    expect(currentSentences()).toEqual([sentence(1)]);
    await user.keyboard("j");
    expect(currentSentences()).toEqual([sentence(0)]);
    await user.keyboard("{End}");
    expect(currentSentences()).toEqual([sentence(2)]);
    await user.keyboard("{Home}");
    expect(currentSentences()).toEqual([sentence(0)]);

    await user.keyboard("{Escape}");
    expect(announcer()).toBe("Stopped");

    await user.keyboard("+");
    expect(readerRoot().style.getPropertyValue("--reader-font-size")).toBe("32px");
    expect(announcer()).toBe("Text size 32");
    await user.keyboard("=");
    expect(readerRoot().style.getPropertyValue("--reader-font-size")).toBe("36px");
    await user.keyboard("-");
    expect(readerRoot().style.getPropertyValue("--reader-font-size")).toBe("32px");

    await user.keyboard("]");
    expect(announcer()).toBe("Speed 1.1×");
    await user.keyboard("]");
    expect(announcer()).toBe("Speed 1.2×");
    await user.keyboard("[[");
    expect(announcer()).toBe("Speed 1.1×");

    await user.keyboard("f");
    expect(readerRoot()).toHaveAttribute("data-view-mode", "focus");
    await user.keyboard("f");
    expect(readerRoot()).toHaveAttribute("data-view-mode", "full");

    await user.keyboard("t");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(announcer()).toBe("Theme: dark");
    await user.keyboard("tt");
    expect(document.documentElement).toHaveAttribute("data-theme", "yellow-black");
    expect(announcer()).toBe("Theme: yellow on black");

    const before = document.activeElement;
    await user.keyboard("?");
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    const table = within(dialog).getByRole("table");
    const text = table.textContent ?? "";
    for (const label of [
      "Play or pause",
      "Stop",
      "Next sentence",
      "Previous sentence",
      "First sentence",
      "Last sentence",
      "Larger text",
      "Smaller text",
      "Faster reading speed",
      "Slower reading speed",
      "focus view",
      "Next theme",
      "Show keyboard shortcuts",
    ]) {
      expect(text).toContain(label);
    }
    // Shortcuts are ignored while the dialog is open.
    await user.keyboard("t");
    expect(document.documentElement).toHaveAttribute("data-theme", "yellow-black");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(before);
    expectNoSentenceInAnnouncer();
  });

  it("are ignored while typing in the textarea", async () => {
    const { user } = setup();
    const textarea = screen.getByLabelText("Text to read");
    await user.click(textarea);
    await user.keyboard("t+-]f? k");
    expect(textarea).toHaveValue("t+-]f? k");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({
      fontSize: 28,
      rate: 1,
      viewMode: "full",
    });
  });

  it("Space activates a focused button instead of toggling playback twice", async () => {
    const { user } = setup();
    const { fake } = installed;
    await importText(user);
    screen.getByRole("button", { name: "Next sentence" }).focus();
    await user.keyboard(" ");
    expect(currentSentences()).toEqual([sentence(1)]);
    expect(fake.spoken).toHaveLength(0);
  });
});

describe("settings", () => {
  it("has labeled controls with the specified names", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    const d = within(dialog);
    const themeGroup = d.getByRole("radiogroup", { name: "Theme" });
    expect(within(themeGroup).getAllByRole("radio")).toHaveLength(5);
    expect(themeGroup.querySelectorAll("[data-swatch]")).toHaveLength(5);
    for (const name of [
      "Text size",
      "Line spacing",
      "Letter spacing",
      "Word spacing",
      "Reading speed",
      "Pitch",
      "Volume",
    ]) {
      expect(d.getByRole("slider", { name })).toBeInTheDocument();
    }
    expect(d.getByRole("slider", { name: "Text size" })).toHaveAttribute("min", "16");
    expect(d.getByRole("slider", { name: "Text size" })).toHaveAttribute("max", "96");
    for (const name of ["Font", "Voice", "Highlight", "View mode"]) {
      expect(d.getByRole("combobox", { name })).toBeInTheDocument();
    }
    expect(within(d.getByRole("combobox", { name: "Voice" })).getByRole("option", { name: "Browser default" })).toBeInTheDocument();
    expect(d.getByRole("checkbox", { name: "Auto-scroll" })).toBeChecked();
    for (const name of ["Smaller", "Larger", "Test voice", "Reset to defaults"]) {
      expect(d.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("lists voices with the browser language first", async () => {
    restoreSpeech();
    installed = installFakeSpeech({
      voices: [
        fakeVoice({ name: "Zed", lang: "fr-FR" }),
        fakeVoice({ name: "Anna", lang: "de-DE" }),
        fakeVoice({ name: "Bob", lang: navigator.language }),
      ],
    });
    restored = false;
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const select = screen.getByRole("combobox", { name: "Voice" });
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options[0]).toBe("Browser default");
    expect(options[1]).toContain("Bob");
    await user.selectOptions(select, "fake:Anna");
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY)!).voiceURI).toBe("fake:Anna");
  });

  it("applies changes live via CSS variables and data-theme, and persists them", async () => {
    const { user, unmount } = setup();
    await importText(user);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const d = within(screen.getByRole("dialog", { name: "Settings" }));

    await user.click(d.getByRole("radio", { name: "Yellow on black" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "yellow-black");

    fireEvent.change(d.getByRole("slider", { name: "Text size" }), { target: { value: "40" } });
    expect(readerRoot().style.getPropertyValue("--reader-font-size")).toBe("40px");
    await user.click(d.getByRole("button", { name: "Larger" }));
    expect(readerRoot().style.getPropertyValue("--reader-font-size")).toBe("44px");
    expect(announcer()).toBe("Text size 44");
    await user.click(d.getByRole("button", { name: "Smaller" }));
    expect(readerRoot().style.getPropertyValue("--reader-font-size")).toBe("40px");

    fireEvent.change(d.getByRole("slider", { name: "Line spacing" }), { target: { value: "2.4" } });
    expect(readerRoot().style.getPropertyValue("--reader-line-height")).toBe("2.4");
    fireEvent.change(d.getByRole("slider", { name: "Letter spacing" }), { target: { value: "0.1" } });
    expect(readerRoot().style.getPropertyValue("--reader-letter-spacing")).toBe("0.1em");
    fireEvent.change(d.getByRole("slider", { name: "Word spacing" }), { target: { value: "0.5" } });
    expect(readerRoot().style.getPropertyValue("--reader-word-spacing")).toBe("0.5em");
    await user.selectOptions(d.getByRole("combobox", { name: "Font" }), "serif");
    expect(readerRoot().style.getPropertyValue("--reader-font")).toContain("var(--font-serif)");
    await user.selectOptions(d.getByRole("combobox", { name: "View mode" }), "focus");
    expect(readerRoot()).toHaveAttribute("data-view-mode", "focus");
    await user.click(d.getByRole("checkbox", { name: "Auto-scroll" }));

    unmount();
    document.documentElement.removeAttribute("data-theme");

    // Remount ("reload"): settings come back from storage.
    const user2 = userEvent.setup();
    render(<ReaderApp />);
    expect(document.documentElement).toHaveAttribute("data-theme", "yellow-black");
    await user2.click(screen.getByRole("button", { name: /^First sentence here\./ }));
    const style = readerRoot().style;
    expect(style.getPropertyValue("--reader-font-size")).toBe("40px");
    expect(style.getPropertyValue("--reader-line-height")).toBe("2.4");
    expect(style.getPropertyValue("--reader-letter-spacing")).toBe("0.1em");
    expect(style.getPropertyValue("--reader-word-spacing")).toBe("0.5em");
    expect(readerRoot()).toHaveAttribute("data-view-mode", "focus");
    await user2.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("checkbox", { name: "Auto-scroll" })).not.toBeChecked();

    await user2.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(readerRoot().style.getPropertyValue("--reader-font-size")).toBe("28px");
  });

  it("speech settings apply to the voice and Test voice speaks a sample", async () => {
    const { user } = setup();
    const { fake } = installed;
    await importText(user);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const d = within(screen.getByRole("dialog", { name: "Settings" }));
    fireEvent.change(d.getByRole("slider", { name: "Pitch" }), { target: { value: "1.5" } });
    fireEvent.change(d.getByRole("slider", { name: "Volume" }), { target: { value: "0.5" } });
    fireEvent.change(d.getByRole("slider", { name: "Reading speed" }), { target: { value: "0.8" } });
    await user.click(d.getByRole("button", { name: "Test voice" }));
    expect(fake.lastSpoken?.text).toBe(SAMPLE_SENTENCE);
    expect(fake.lastSpoken).toMatchObject({ pitch: 1.5, volume: 0.5, rate: 0.8 });
  });

  it("traps focus, closes with Escape and returns focus to the Settings button", async () => {
    const { user } = setup();
    const settingsButton = screen.getByRole("button", { name: "Settings" });
    await user.click(settingsButton);
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const close = within(dialog).getByRole("button", { name: "Close" });
    const reset = within(dialog).getByRole("button", { name: "Reset to defaults" });
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(reset).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(settingsButton).toHaveFocus();

    // The Close button also returns focus.
    await user.click(settingsButton);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(settingsButton).toHaveFocus();
  });

  it("Escape in the settings dialog does not stop playback", async () => {
    const { user } = setup();
    await importText(user);
    await user.click(screen.getByRole("button", { name: "Play" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });
});

describe("recent documents", () => {
  it("lists saved documents, opens them and offers to resume", async () => {
    const doc = saveDocument({ title: "My article", text: TEXT, source: "url" });
    updateProgress(doc.id, 2);
    const { user } = setup();
    const { fake } = installed;
    const open = screen.getByRole("button", { name: /^My article/ });
    expect(open).toHaveTextContent("Web page");
    expect(open.textContent).toMatch(/\d{4}/);
    expect(screen.getByRole("button", { name: "Delete My article" })).toBeInTheDocument();

    await user.click(open);
    expect(screen.getByRole("heading", { level: 1, name: "My article" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Start from beginning" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue from sentence 3" }));
    expect(fake.spokenTexts).toEqual([SENTENCES[2]]);
    expect(currentSentences()).toEqual([sentence(2)]);
    expect(screen.queryByRole("button", { name: /Continue from sentence/ })).not.toBeInTheDocument();
  });

  it("Start from beginning reads from the first sentence", async () => {
    const doc = saveDocument({ title: "My article", text: TEXT, source: "paste" });
    updateProgress(doc.id, 1);
    const { user } = setup();
    const { fake } = installed;
    await user.click(screen.getByRole("button", { name: /^My article/ }));
    await user.click(screen.getByRole("button", { name: "Start from beginning" }));
    expect(fake.spokenTexts).toEqual([SENTENCES[0]]);
  });

  it("saves the reading position while playing and offers it later", async () => {
    const { user } = setup();
    await importText(user);
    await user.click(screen.getByRole("button", { name: "Play" }));
    await user.click(screen.getByRole("button", { name: "Next sentence" }));
    await waitFor(() => expect(listDocuments()[0].lastSentenceIndex).toBe(1));
    await user.click(screen.getByRole("button", { name: "Next sentence" }));
    // Going home saves immediately (no need to wait for the debounce).
    await user.click(screen.getByRole("button", { name: "New document" }));
    expect(listDocuments()[0].lastSentenceIndex).toBe(2);
    await user.click(screen.getByRole("button", { name: /^First sentence here\./ }));
    expect(screen.getByRole("button", { name: "Continue from sentence 3" })).toBeInTheDocument();
  });

  it("deletes a document", async () => {
    saveDocument({ title: "Old one", text: "Some old text.", source: "file" });
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Delete Old one" }));
    expect(screen.queryByRole("button", { name: /^Old one/ })).not.toBeInTheDocument();
    expect(listDocuments()).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Recent documents" })).toHaveFocus();
  });
});

describe("without speech synthesis", () => {
  it("shows a notice; text display and settings still work", async () => {
    restoreSpeech();
    const { user } = setup();
    expect(screen.getByRole("note", { name: "Speech not available" })).toHaveTextContent(
      /Reading aloud is not available in this browser/,
    );
    await importText(user);
    expect(screen.getByRole("heading", { level: 1, name: "First sentence here." })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(sentence(1)).toHaveTextContent(SENTENCES[1]);
    await user.click(screen.getByRole("button", { name: "Next sentence" }));
    expect(currentSentences()).toEqual([sentence(1)]);
    await user.click(sentence(2));
    expect(currentSentences()).toEqual([sentence(2)]);
    expect(screen.queryByText(/speech engine reported a problem/)).not.toBeInTheDocument();
    await user.keyboard("+");
    expect(readerRoot().style.getPropertyValue("--reader-font-size")).toBe("32px");
  });

  it("does not show the notice when speech is supported", () => {
    setup();
    expect(screen.queryByRole("note", { name: "Speech not available" })).not.toBeInTheDocument();
  });
});
