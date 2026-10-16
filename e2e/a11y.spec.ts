import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, gotoHome, pasteAndRead, test } from "./fixtures";

const THEMES = ["light", "dark", "high-contrast", "yellow-black", "sepia"] as const;
const SETTINGS_KEY = "readaloud:settings:v1";
const TEXT =
  "Accessibility matters for every reader. The highlighted sentence and word must have enough contrast. Settings must be usable with assistive technology.";
const NOTE = "Check the contrast of the notes panel.";
const NOTE_MORE = "The preview on Home must be readable too.";

// Slow speech so the word highlight can be captured mid-sentence.
test.use({ speechWordIntervalMs: 150 });

async function expectNoViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  // Guard against a vacuous pass (e.g. axe not injected or nothing scanned).
  expect(results.passes.length, `axe ran no rules on ${label}`).toBeGreaterThan(10);
  const summary = results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.map((n) => n.target.join(" ")),
  }));
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

/** Type a note in the reader and wait until it has been saved. */
async function writeNote(page: Page, note: string) {
  await page.getByRole("textbox", { name: "Note for this document" }).fill(note);
  await expect(page.getByTestId("note-save-status")).toHaveText("Saving…");
  await expect(page.getByTestId("note-save-status")).toHaveText("Saved");
}

for (const theme of THEMES) {
  test(`no WCAG 2.1 AA violations in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, JSON.stringify({ theme: value })),
      [SETTINGS_KEY, theme] as const,
    );
    await gotoHome(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    await test.step("Home", async () => {
      await expectNoViolations(page, `Home (${theme})`);
    });

    await test.step("Home with a recent document", async () => {
      await pasteAndRead(page, TEXT);
      // Give the entry a note so its preview is checked too.
      await writeNote(page, NOTE);
      await page.getByRole("button", { name: "New document" }).click();
      const recent = page.getByRole("region", { name: "Recent documents" });
      await expect(recent.getByRole("listitem")).toHaveCount(1);
      await expect(recent.getByTestId("note-preview")).toHaveText(`Note: ${NOTE}`);
      await expectNoViolations(page, `Home with recent documents (${theme})`);
    });

    await test.step("Reader view", async () => {
      await page
        .getByRole("region", { name: "Recent documents" })
        .getByRole("button", { name: /^Accessibility matters/ })
        .click();
      await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
      // With a note in the notes panel.
      await expect(page.getByRole("textbox", { name: "Note for this document" })).toHaveValue(NOTE);
      await writeNote(page, `${NOTE} ${NOTE_MORE}`);
      await expect(
        page.getByRole("region", { name: "Notes" }).getByRole("button", { name: "Read note" }),
      ).toBeEnabled();
      await expectNoViolations(page, `reader view (${theme})`);

      // With sentence and word highlighting visible (paused mid-sentence).
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await expect(page.locator("mark.word-current")).toBeVisible();
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await expect(page.locator("mark.word-current")).toBeVisible();
      await expectNoViolations(page, `reader view while reading (${theme})`);
    });

    await test.step("Settings dialog", async () => {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
      await expectNoViolations(page, `settings dialog (${theme})`);
    });

    await test.step("Keyboard shortcuts dialog", async () => {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeHidden();
      await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
      await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
      await expectNoViolations(page, `keyboard shortcuts dialog (${theme})`);
    });
  });
}
