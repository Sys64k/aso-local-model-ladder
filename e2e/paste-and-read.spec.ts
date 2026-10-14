import {
  announcer,
  currentSentence,
  expect,
  gotoHome,
  pasteAndRead,
  sentence,
  spokenTexts,
  test,
} from "./fixtures";

const S0 = "The quick brown fox jumps over the lazy dog.";
// Long enough that Pause / Next can be clicked comfortably while it is spoken.
const S1 =
  "Then the fox ran across the wide green field, past the old farmhouse, over the little wooden bridge and into the dark forest.";
const S2 = "That is the end of the story.";
const TEXT = `${S0} ${S1} ${S2}`;

// ~100 ms per speech event: S0 takes about a second, S1 about two and a half.
test.use({ speechWordIntervalMs: 100 });

test("paste text, read it aloud with highlighting, pause, skip and finish", async ({ page }) => {
  await gotoHome(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "What would you like to read?" }),
  ).toBeVisible();

  await pasteAndRead(page, TEXT);

  // Focus moves to the document heading (title derived from the first sentence).
  const heading = page.getByRole("heading", { level: 1, name: S0 });
  await expect(heading).toBeFocused();
  await expect(page.locator("[data-sentence-index]")).toHaveCount(3);
  await expect(sentence(page, 0)).toHaveText(S0);
  await expect(sentence(page, 1)).toHaveText(S1);
  await expect(sentence(page, 2)).toHaveText(S2);
  await expect(page.getByText("Sentence 1 of 3")).toBeVisible();

  // Play: sentence 0 is read and highlighted.
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(announcer(page)).toHaveText(/Playing/);
  await expect(sentence(page, 0)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => spokenTexts(page)).toEqual([S0]);
  // Word highlighting follows the boundary events.
  await expect(page.locator("mark.word-current")).toBeVisible();

  // ...then sentence 1 automatically.
  await expect(sentence(page, 1)).toHaveAttribute("aria-current", "true");
  await expect(sentence(page, 0)).not.toHaveAttribute("aria-current", "true");
  await expect(currentSentence(page)).toHaveCount(1);
  await expect(page.getByText("Sentence 2 of 3")).toBeVisible();
  await expect.poll(() => spokenTexts(page)).toEqual([S0, S1]);

  // Pause: nothing advances while paused.
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(announcer(page)).toHaveText(/Paused/);
  await page.waitForTimeout(800);
  await expect(sentence(page, 1)).toHaveAttribute("aria-current", "true");
  expect(await spokenTexts(page)).toEqual([S0, S1]);

  // Play again resumes the same utterance (no new speak() call).
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(sentence(page, 1)).toHaveAttribute("aria-current", "true");
  expect(await spokenTexts(page)).toEqual([S0, S1]);

  // Next sentence jumps ahead and speaks it.
  await page.getByRole("button", { name: "Next sentence" }).click();
  await expect(sentence(page, 2)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => spokenTexts(page)).toEqual([S0, S1, S2]);

  // Previous sentence goes back.
  await page.getByRole("button", { name: "Previous sentence" }).click();
  await expect(sentence(page, 1)).toHaveAttribute("aria-current", "true");
  await expect.poll(() => spokenTexts(page)).toEqual([S0, S1, S2, S1]);

  // Reading continues to the end and announces it.
  await expect(announcer(page)).toHaveText(/Finished reading/, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  expect(await spokenTexts(page)).toEqual([S0, S1, S2, S1, S2]);
  await expect(sentence(page, 2)).toHaveAttribute("aria-current", "true");
});

test("Stop ends reading and announces it", async ({ page }) => {
  await gotoHome(page);
  await pasteAndRead(page, TEXT);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(announcer(page)).toHaveText(/Stopped/);
  const spoken = await spokenTexts(page);
  await page.waitForTimeout(500);
  expect(await spokenTexts(page)).toEqual(spoken);
});
