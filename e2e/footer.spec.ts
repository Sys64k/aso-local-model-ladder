import pkg from "../package.json";
import { expect, gotoHome, pasteAndRead, test } from "./fixtures";

// next.config.ts bakes `process.env.APP_VERSION || pkg.version` into the build.
const EXPECTED_VERSION = process.env.APP_VERSION || pkg.version;
const EXPECTED_LABEL = EXPECTED_VERSION === "dev" ? "dev" : `v${EXPECTED_VERSION}`;

test("footer shows the app version on Home", async ({ page }) => {
  await gotoHome(page);

  const footer = page.getByRole("contentinfo");
  await expect(footer).toBeVisible();
  await expect(footer).toContainText(`ReadAloud ${EXPECTED_LABEL}`);
  await expect(page.getByTestId("app-version")).toHaveText(EXPECTED_LABEL);
  if (!process.env.APP_VERSION) {
    await expect(page.getByTestId("app-version")).toHaveText(`v${pkg.version}`);
    await expect(footer).toContainText(/v\d+\.\d+\.\d+/);
  }
});

test("footer stays visible on the Reader screen", async ({ page }) => {
  await gotoHome(page);
  await pasteAndRead(page, "Hello world. Second sentence.");

  const footer = page.getByRole("contentinfo");
  await expect(footer).toBeVisible();
  await expect(page.getByTestId("app-version")).toHaveText(EXPECTED_LABEL);
});

test("footer is inert while the Settings dialog is open", async ({ page }) => {
  await gotoHome(page);
  await expect(page.locator("[inert] footer")).toHaveCount(0);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();

  // The footer is still rendered, but inside the inert page wrapper.
  const footer = page.locator("footer");
  await expect(footer).toHaveCount(1);
  await expect(page.locator("[inert] footer")).toHaveCount(1);
  await expect(dialog.locator("footer")).toHaveCount(0);
  expect(await footer.evaluate((el) => el.closest("[inert]") !== null)).toBe(true);

  // Closing the dialog restores it.
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[inert] footer")).toHaveCount(0);
  await expect(page.getByRole("contentinfo")).toBeVisible();
});
