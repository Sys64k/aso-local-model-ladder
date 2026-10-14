import { announcer, expect, gotoHome, sentence, spokenTexts, test } from "./fixtures";

const S0 =
  "Keyboard users can do everything in this reading assistant without ever touching a mouse.";
const S1 = "The arrow keys move between sentences.";
const S2 = "Escape stops reading.";
const TEXT = `${S0} ${S1} ${S2}`;

// Slow enough that sentence 0 (15 words) takes about three seconds, so it is
// certainly still being read when ArrowRight is pressed.
test.use({ speechWordIntervalMs: 200 });

test("the whole journey works with the keyboard only", async ({ page }) => {
  const kb = page.keyboard;
  await gotoHome(page);

  // Skip link is the first Tab stop and jumps to the main content.
  await kb.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await kb.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  // Next Tab stop is the selected tab; arrow keys move between tabs.
  await kb.press("Tab");
  const pasteTab = page.getByRole("tab", { name: "Paste text" });
  await expect(pasteTab).toBeFocused();
  await expect(pasteTab).toHaveAttribute("aria-selected", "true");

  await kb.press("ArrowRight");
  const uploadTab = page.getByRole("tab", { name: "Upload file" });
  await expect(uploadTab).toBeFocused();
  await expect(uploadTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Upload file" })).toBeVisible();

  await kb.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Take photo" })).toBeFocused();
  await kb.press("ArrowLeft");
  await kb.press("ArrowLeft");
  await expect(pasteTab).toBeFocused();
  await expect(pasteTab).toHaveAttribute("aria-selected", "true");

  // Into the panel: type the text and submit.
  await kb.press("Tab");
  const textarea = page.getByRole("textbox", { name: "Text to read" });
  await expect(textarea).toBeFocused();
  await kb.type(TEXT);
  await expect(textarea).toHaveValue(TEXT);

  await kb.press("Tab");
  await expect(page.getByRole("button", { name: "Read this text" })).toBeFocused();
  await kb.press("Enter");

  // S0 is longer than 60 characters, so the title is cut at a word with "…".
  const heading = page.getByRole("heading", {
    level: 1,
    name: /^Keyboard users can do everything in this reading assistant…$/,
  });
  await expect(heading).toBeFocused();

  // Space plays.
  await kb.press(" ");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(sentence(page, 0)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => spokenTexts(page)).toEqual([S0]);

  // ArrowRight goes to the next sentence.
  await kb.press("ArrowRight");
  await expect(sentence(page, 1)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => spokenTexts(page)).toEqual([S0, S1]);

  // Space again pauses.
  await kb.press(" ");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(announcer(page)).toHaveText(/Paused/);

  // + enlarges the text (default 28px, step 4).
  const reader = page.locator(".reader-root");
  await expect(reader).toHaveCSS("font-size", "28px");
  await kb.type("+");
  await expect(announcer(page)).toHaveText(/Text size 32/);
  await expect(reader).toHaveCSS("font-size", "32px");

  // T switches to the next theme.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await kb.press("t");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(announcer(page)).toHaveText(/Theme: dark/);

  // ? opens the shortcuts help; focus moves into it.
  await kb.type("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  await expect(help.getByRole("button", { name: "Close" })).toBeFocused();
  await expect(help.getByRole("table")).toContainText("Play or pause");

  // Escape closes it (without stopping) and focus returns to where it was.
  await kb.press("Escape");
  await expect(help).toBeHidden();
  await expect(heading).toBeFocused();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();

  // Resume with Space, then Escape stops reading.
  await kb.press(" ");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await kb.press("Escape");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(announcer(page)).toHaveText(/Stopped/);

  // Back to Home: Shift+Tab reaches "New document" right before the heading.
  await kb.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "New document" })).toBeFocused();
  await kb.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "What would you like to read?" }),
  ).toBeFocused();
  await expect(
    page
      .getByRole("region", { name: "Recent documents" })
      .getByRole("button", { name: /^Keyboard users can do everything/ }),
  ).toBeVisible();
});

test("settings dialog traps focus and Escape returns focus to the Settings button", async ({
  page,
}) => {
  const kb = page.keyboard;
  await gotoHome(page);

  // Skip link, then the Settings button.
  await kb.press("Tab");
  await kb.press("Tab");
  const settingsButton = page.getByRole("button", { name: "Settings", exact: true });
  await expect(settingsButton).toBeFocused();
  await kb.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", { name: "Close" });
  await expect(close).toBeFocused();

  // Shift+Tab from the first control wraps to the last one (Reset to defaults).
  await kb.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Reset to defaults" })).toBeFocused();
  await kb.press("Tab");
  await expect(close).toBeFocused();

  await kb.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(settingsButton).toBeFocused();
});
