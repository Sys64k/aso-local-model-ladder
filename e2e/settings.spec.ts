import {
  currentSentence,
  expect,
  gotoHome,
  pasteAndRead,
  sentence,
  test,
  waitForHydration,
} from "./fixtures";

const SENTENCES = [
  "Settings are saved in this browser.",
  "They survive a page reload.",
  "Reset to defaults puts everything back.",
  "Focus view shows one sentence at a time.",
  "The rest of the document is hidden.",
];
const TEXT = SENTENCES.join(" ");

test("theme and text size persist across reloads and can be reset", async ({ page }) => {
  await gotoHome(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();

  const theme = dialog.getByRole("radiogroup", { name: "Theme" });
  await expect(theme.getByRole("radio", { name: "Light" })).toBeChecked();
  await theme.getByRole("radio", { name: "Yellow on black" }).check();
  await expect(html).toHaveAttribute("data-theme", "yellow-black");
  // The page actually uses the theme colours (yellow text on black).
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(page.locator("body")).toHaveCSS("color", "rgb(255, 255, 0)");

  const size = dialog.getByRole("slider", { name: "Text size" });
  await expect(size).toHaveValue("28");
  await size.fill("40");
  await expect(size).toHaveValue("40");
  await expect(size).toHaveAttribute("aria-valuetext", "40 pixels");

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  // Reload: both settings are still applied.
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "yellow-black");
  await expect(page.locator("body")).toHaveCSS("color", "rgb(255, 255, 0)");
  await waitForHydration(page);
  await expect(html).toHaveAttribute("data-theme", "yellow-black");

  await pasteAndRead(page, TEXT);
  await expect(page.locator(".reader-root")).toHaveCSS("font-size", "40px");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog.getByRole("radio", { name: "Yellow on black" })).toBeChecked();
  await expect(dialog.getByRole("slider", { name: "Text size" })).toHaveValue("40");

  // Reset to defaults restores the theme and the text size.
  await dialog.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(dialog.getByRole("radio", { name: "Light" })).toBeChecked();
  await expect(dialog.getByRole("slider", { name: "Text size" })).toHaveValue("28");
  await expect(page.locator(".reader-root")).toHaveCSS("font-size", "28px");

  // ...and the reset is persisted too.
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog.getByRole("radio", { name: "Light" })).toBeChecked();
  await expect(dialog.getByRole("slider", { name: "Text size" })).toHaveValue("28");
});

test("voice list shows the available voices", async ({ page }) => {
  await gotoHome(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const voice = page.getByRole("dialog", { name: "Settings", exact: true }).getByRole("combobox", {
    name: "Voice",
  });
  await expect(voice.locator("option")).toHaveText([
    "Browser default",
    "Fake English (en-US) – default",
    "Fake Spanish (es-ES)",
  ]);
  await voice.selectOption("fake-es-ES");
  await expect(voice).toHaveValue("fake-es-ES");
});

test("focus view shows only the current sentence with its neighbours as context", async ({
  page,
}) => {
  await gotoHome(page);
  await pasteAndRead(page, TEXT);
  await expect(page.locator("[data-sentence-index]")).toHaveCount(SENTENCES.length);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("combobox", { name: "View mode" }).selectOption("focus");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  // Move to the middle of the document.
  await page.getByRole("button", { name: "Next sentence" }).click();
  await page.getByRole("button", { name: "Next sentence" }).click();
  await expect(page.getByText(`Sentence 3 of ${SENTENCES.length}`)).toBeVisible();

  // Only sentence 2 is the current (large) sentence; just its neighbours are
  // shown as dimmed context and the rest of the document is not rendered.
  await expect(currentSentence(page)).toHaveCount(1);
  await expect(currentSentence(page)).toHaveText(SENTENCES[2]);
  await expect(currentSentence(page)).toHaveClass(/focus-current/);
  await expect(page.locator("[data-sentence-index]")).toHaveCount(3);
  await expect(sentence(page, 1)).toHaveClass(/focus-context/);
  await expect(sentence(page, 3)).toHaveClass(/focus-context/);
  await expect(sentence(page, 0)).toHaveCount(0);
  await expect(sentence(page, 4)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Document text" })).not.toContainText(
    SENTENCES[4],
  );

  // The current sentence is shown 1.5× larger than the context (28px default).
  await expect(currentSentence(page)).toHaveCSS("font-size", "42px");
  await expect(sentence(page, 1)).toHaveCSS("font-size", "28px");
  await expect(sentence(page, 3)).toHaveCSS("font-size", "28px");

  // Back to full view: all sentences are visible again.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await dialog.getByRole("combobox", { name: "View mode" }).selectOption("full");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("[data-sentence-index]")).toHaveCount(SENTENCES.length);
});
