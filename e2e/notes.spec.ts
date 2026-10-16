import type { Page } from "@playwright/test";
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

// Document: the first sentence (the title) is short; the rest is long enough
// that the document is still being read while the note is used.
const D0 = "Notes belong to their document.";
const D1 =
  "This second sentence is deliberately long so that the document is still being read aloud while the tests type in the note and press the buttons.";
const D2 =
  "The third sentence keeps the reading going for a little while longer, with plenty of words for the fake speech engine to work through.";
const D3 = "That is the end.";
const TEXT = [D0, D1, D2, D3].join(" ");
const TITLE = D0;

// Two sentences, under 80 characters together (so the Home preview shows it all).
const N0 = "Check chapter two again before the exam next week.";
const N1 = "Ask about the ending.";
const NOTE = `${N0} ${N1}`;
// A note whose first sentence takes about three seconds to read, so it can
// certainly be interrupted before the second sentence starts.
const LONG_N0 =
  "This first note sentence is long on purpose so that there is plenty of time to interrupt it with the Play button or the Escape key.";
const LONG_N1 = "This sentence should never be spoken.";
const INTERRUPTED_NOTE = `${LONG_N0} ${LONG_N1}`;

const LONG_NOTE =
  "This note is deliberately long so that the preview on the home screen has to be cut short somewhere.";
const LONG_NOTE_PREVIEW =
  "This note is deliberately long so that the preview on the home screen has to be…";

// ~100 ms per speech event: N0 takes about a second, D1 about three seconds.
test.use({ speechWordIntervalMs: 100 });

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function notes(page: Page) {
  return page.getByRole("region", { name: "Notes" });
}
function noteBox(page: Page) {
  return notes(page).getByRole("textbox", { name: "Note for this document" });
}
function saveStatus(page: Page) {
  return page.getByTestId("note-save-status");
}
function readNoteButton(page: Page) {
  return notes(page).getByRole("button", { name: "Read note", exact: true });
}
function stopNoteButton(page: Page) {
  return notes(page).getByRole("button", { name: "Stop reading note", exact: true });
}
function playButton(page: Page) {
  return page.getByRole("button", { name: "Play", exact: true });
}
function pauseButton(page: Page) {
  return page.getByRole("button", { name: "Pause", exact: true });
}
function recent(page: Page) {
  return page.getByRole("region", { name: "Recent documents" });
}
/** The "open" button of the Recent documents entry (not its Delete button). */
function recentEntry(page: Page, title = TITLE) {
  return recent(page).getByRole("button", { name: new RegExp(`^${escapeRegExp(title)}`) });
}

/** Type a note and wait until it has been saved. */
async function writeNote(page: Page, note: string) {
  await noteBox(page).fill(note);
  await expect(saveStatus(page)).toHaveText("Saving…");
  await expect(saveStatus(page)).toHaveText("Saved");
}

test("a note persists across a reload and is previewed on Home", async ({ page }) => {
  await gotoHome(page);
  await pasteAndRead(page, TEXT);

  await expect(notes(page).getByRole("heading", { level: 2, name: "Notes" })).toBeVisible();
  await expect(noteBox(page)).toHaveValue("");
  await expect(saveStatus(page)).toHaveText("Saved");

  await writeNote(page, NOTE);

  await page.reload();
  await waitForHydration(page);

  // Home preview: "Note: " plus the (short) note inside the open button.
  const entry = recentEntry(page);
  await expect(entry).toBeVisible();
  const preview = entry.getByTestId("note-preview");
  await expect(preview).toHaveText(`Note: ${NOTE}`);

  await entry.click();
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeFocused();
  await expect(noteBox(page)).toHaveValue(NOTE);
  await expect(saveStatus(page)).toHaveText("Saved");
  await expect(readNoteButton(page)).toBeEnabled();
});

test("Home shows a note preview, truncating long notes with an ellipsis", async ({ page }) => {
  await gotoHome(page);
  await pasteAndRead(page, TEXT);
  await writeNote(page, NOTE);

  await page.getByRole("button", { name: "New document" }).click();
  const preview = recentEntry(page).getByTestId("note-preview");
  await expect(preview).toHaveText(`Note: ${NOTE}`);
  expect(NOTE.length).toBeLessThanOrEqual(80);
  await expect(preview).toHaveText(/^Note: Check chapter two/);

  // A long note (> 80 characters) is cut at a word with "…".
  expect(LONG_NOTE.length).toBeGreaterThan(80);
  await recentEntry(page).click();
  await expect(noteBox(page)).toHaveValue(NOTE);
  await writeNote(page, LONG_NOTE);
  await page.getByRole("button", { name: "New document" }).click();

  await expect(preview).toHaveText(`Note: ${LONG_NOTE_PREVIEW}`);
  await expect(preview).toHaveText(/…$/);
  await expect(preview).not.toContainText("somewhere");
  const text = (await preview.textContent()) ?? "";
  expect(text.length).toBeLessThanOrEqual("Note: ".length + 81);
});

test("Read note speaks the note's sentences and toggles the button", async ({ page }) => {
  await gotoHome(page);
  await pasteAndRead(page, TEXT);
  await writeNote(page, NOTE);

  await readNoteButton(page).click();
  await expect(stopNoteButton(page)).toBeVisible();
  await expect(announcer(page)).toHaveText(/^Reading note\s*$/);
  await expect.poll(() => spokenTexts(page)).toEqual([N0]);

  // When the note is finished the button toggles back.
  await expect.poll(() => spokenTexts(page)).toEqual([N0, N1]);
  await expect(readNoteButton(page)).toBeVisible({ timeout: 15_000 });
  await expect(stopNoteButton(page)).toHaveCount(0);
  await expect(announcer(page)).toHaveText(/^Finished reading note\s*$/);
  // The document itself was never played.
  await expect(playButton(page)).toBeVisible();
  expect(await spokenTexts(page)).toEqual([N0, N1]);

  // Read again, then stop it with the same button.
  await readNoteButton(page).click();
  await expect(stopNoteButton(page)).toBeVisible();
  await expect.poll(() => spokenTexts(page)).toEqual([N0, N1, N0]);
  await stopNoteButton(page).click();
  await expect(readNoteButton(page)).toBeVisible();
  await expect(announcer(page)).toHaveText(/^Stopped reading note\s*$/);
  const afterStop = await spokenTexts(page);
  await page.waitForTimeout(1500);
  expect(await spokenTexts(page)).toEqual(afterStop);
});

test("note reading and document playback interrupt each other; Escape stops the note", async ({
  page,
}) => {
  await gotoHome(page);
  await pasteAndRead(page, TEXT);
  await writeNote(page, INTERRUPTED_NOTE);

  // Document playback, then Read note: the document stops, the note is spoken.
  await playButton(page).click();
  await expect(pauseButton(page)).toBeVisible();
  await expect.poll(() => spokenTexts(page)).toEqual([D0]);

  await readNoteButton(page).click();
  await expect(playButton(page)).toBeVisible();
  await expect(stopNoteButton(page)).toBeVisible();
  await expect.poll(async () => (await spokenTexts(page)).at(-1)).toBe(LONG_N0);
  await expect(announcer(page)).toHaveText(/^Reading note\s*$/);
  const afterNote = await spokenTexts(page);
  expect(afterNote).toEqual([D0, LONG_N0]);

  // Play: the note stops and the document plays.
  await playButton(page).click();
  await expect(pauseButton(page)).toBeVisible();
  await expect(readNoteButton(page)).toBeVisible();
  await expect(announcer(page)).toHaveText(/^Playing\s*$/);
  await expect.poll(async () => (await spokenTexts(page)).at(-1)).not.toBe(LONG_N0);
  // Long enough for the rest of the note to have been read had it continued.
  await page.waitForTimeout(3500);
  expect(await spokenTexts(page)).not.toContain(LONG_N1);
  await expect(pauseButton(page)).toBeVisible();

  // Read note again (stops the document), then Escape stops the note.
  await readNoteButton(page).click();
  await expect(stopNoteButton(page)).toBeVisible();
  await expect(playButton(page)).toBeVisible();
  await expect.poll(async () => (await spokenTexts(page)).at(-1)).toBe(LONG_N0);
  await page.keyboard.press("Escape");
  await expect(readNoteButton(page)).toBeVisible();
  await expect(announcer(page)).toHaveText(/^Stopped reading note\s*$/);
  await expect(playButton(page)).toBeVisible();
  const afterEscape = await spokenTexts(page);
  await page.waitForTimeout(3500);
  expect(await spokenTexts(page)).toEqual(afterEscape);
  expect(afterEscape).not.toContain(LONG_N1);
});

test("typing in the note does not affect document playback", async ({ page }) => {
  await gotoHome(page);
  await pasteAndRead(page, TEXT);

  await playButton(page).click();
  await expect(pauseButton(page)).toBeVisible();
  await expect(sentence(page, 0)).toHaveAttribute("aria-current", "true");

  // Typing (including Space and shortcut letters like k, t, f, j, l) while the
  // document plays leaves it playing.
  await noteBox(page).click();
  const typed = "keep track of the final jolly line";
  await noteBox(page).pressSequentially(typed);
  await expect(noteBox(page)).toHaveValue(typed);
  await expect(pauseButton(page)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(announcer(page)).not.toHaveText(/Stopped|Paused/);

  // The document keeps reading.
  await expect(sentence(page, 1)).toHaveAttribute("aria-current", "true", { timeout: 15_000 });
  await expect.poll(() => spokenTexts(page)).toEqual([D0, D1]);
  await expect(pauseButton(page)).toBeVisible();
  await expect(saveStatus(page)).toHaveText("Saved");

  // Paused: Space in the textarea types a space and does not resume playback.
  await pauseButton(page).click();
  await expect(playButton(page)).toBeVisible();
  await noteBox(page).click();
  await noteBox(page).press("End");
  await page.keyboard.press(" ");
  await expect(noteBox(page)).toHaveValue(`${typed} `);
  await page.waitForTimeout(500);
  await expect(playButton(page)).toBeVisible();
  await expect(pauseButton(page)).toHaveCount(0);
  expect(await spokenTexts(page)).toEqual([D0, D1]);
});

test("deleting a document from Home deletes its note", async ({ page }) => {
  await gotoHome(page);
  await pasteAndRead(page, TEXT);
  await writeNote(page, NOTE);

  await page.getByRole("button", { name: "New document" }).click();
  await expect(recentEntry(page).getByTestId("note-preview")).toBeVisible();

  await recent(page).getByRole("button", { name: `Delete ${TITLE}` }).click();
  await expect(recent(page).getByRole("listitem")).toHaveCount(0);
  await expect(announcer(page)).toHaveText(
    new RegExp(`^Deleted ${escapeRegExp(TITLE)} and its note\\s*$`),
  );

  await page.reload();
  await waitForHydration(page);
  await expect(recent(page)).toContainText("Nothing here yet");

  // Re-pasting the same text starts with an empty note.
  await pasteAndRead(page, TEXT);
  await expect(noteBox(page)).toHaveValue("");
  await expect(readNoteButton(page)).toBeDisabled();
});

test("Read note is disabled for a blank note", async ({ page }) => {
  await gotoHome(page);
  await pasteAndRead(page, TEXT);

  await expect(noteBox(page)).toHaveValue("");
  await expect(readNoteButton(page)).toBeDisabled();

  // Whitespace only still counts as blank.
  await noteBox(page).fill("   \n  ");
  await expect(readNoteButton(page)).toBeDisabled();

  await noteBox(page).fill(N1);
  await expect(readNoteButton(page)).toBeEnabled();

  await noteBox(page).fill("");
  await expect(readNoteButton(page)).toBeDisabled();
  await expect(saveStatus(page)).toHaveText("Saved");
  expect(await spokenTexts(page)).toEqual([]);
});
