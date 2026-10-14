import {
  announcer,
  expect,
  gotoHome,
  pasteAndRead,
  sentence,
  spokenTexts,
  test,
  waitForHydration,
} from "./fixtures";

const S0 = "Recent documents remember where you stopped.";
const S1 =
  "When you come back later you can continue from the same sentence instead of starting again from the very beginning of the text.";
const S2 = "You can also delete documents you no longer need.";
const S3 = "That keeps the list tidy.";
const TEXT = [S0, S1, S2, S3].join(" ");

test.use({ speechWordIntervalMs: 100 });

test("read partway, reopen from Recent documents, continue, then delete", async ({ page }) => {
  await gotoHome(page);
  const recent = page.getByRole("region", { name: "Recent documents" });
  await expect(recent).toContainText("Nothing here yet");

  // Read partway: into sentence 2, then pause.
  await pasteAndRead(page, TEXT);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(sentence(page, 1)).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(sentence(page, 1)).toHaveAttribute("aria-current", "true");

  // New document: back to Home, the document is listed.
  await page.getByRole("button", { name: "New document" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "What would you like to read?" }),
  ).toBeFocused();
  const item = recent.getByRole("listitem");
  await expect(item).toHaveCount(1);
  const openButton = recent.getByRole("button", { name: new RegExp(`^${S0}`) });
  await expect(openButton).toBeVisible();
  await expect(openButton).toContainText("Pasted text");

  // It survives a reload.
  await page.reload();
  await waitForHydration(page);
  await expect(openButton).toBeVisible();

  // Reopen: offered to continue from the saved sentence.
  await openButton.click();
  await expect(page.getByRole("heading", { level: 1, name: S0 })).toBeFocused();
  const resume = page.getByRole("group", { name: "Resume reading" });
  await expect(resume).toBeVisible();
  const cont = resume.getByRole("button", { name: "Continue from sentence 2" });
  await expect(cont).toBeVisible();
  await expect(resume.getByRole("button", { name: "Start from beginning" })).toBeVisible();

  await cont.click();
  await expect(resume).toBeHidden();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(sentence(page, 1)).toHaveAttribute("aria-current", "true");
  await expect.poll(async () => (await spokenTexts(page))[0]).toBe(S1);
  // Reading carries on from there.
  await expect(sentence(page, 2)).toHaveAttribute("aria-current", "true", { timeout: 15_000 });
  expect((await spokenTexts(page)).slice(0, 2)).toEqual([S1, S2]);

  await page.getByRole("button", { name: "Stop" }).click();
  await page.getByRole("button", { name: "New document" }).click();

  // Delete removes it from the list.
  const del = recent.getByRole("button", { name: `Delete ${S0}` });
  await expect(del).toBeVisible();
  await del.click();
  await expect(recent.getByRole("listitem")).toHaveCount(0);
  await expect(recent).toContainText("Nothing here yet");
  await expect(announcer(page)).toHaveText(new RegExp(`Deleted ${S0}`));
  await expect(page.getByRole("heading", { name: "Recent documents" })).toBeFocused();

  // Deleted for good.
  await page.reload();
  await waitForHydration(page);
  await expect(recent).toContainText("Nothing here yet");
});
