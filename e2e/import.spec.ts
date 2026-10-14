import path from "node:path";
import { expect, gotoHome, sentence, test } from "./fixtures";

const SAMPLE = path.join(__dirname, "fixtures", "sample.txt");

// No test in this file may reach the outside network: /api/extract is mocked
// and everything else must come from the local server.
let externalRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  externalRequests = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.protocol.startsWith("http") && !["localhost", "127.0.0.1"].includes(url.hostname)) {
      externalRequests.push(req.url());
    }
  });
});

test.afterEach(() => {
  expect(externalRequests).toEqual([]);
});

test("upload a text file through the Upload file tab", async ({ page }) => {
  await gotoHome(page);
  await page.getByRole("tab", { name: "Upload file" }).click();
  const panel = page.getByRole("tabpanel", { name: "Upload file" });
  await expect(panel).toBeVisible();

  await panel.getByLabel("Choose a file").setInputFiles(SAMPLE);

  // The file name (without extension) becomes the title.
  await expect(page.getByRole("heading", { level: 1, name: "sample" })).toBeFocused();
  await expect(page.locator("[data-sentence-index]")).toHaveCount(4);
  await expect(sentence(page, 0)).toHaveText(
    "This sample file was uploaded in an end-to-end test.",
  );
  await expect(sentence(page, 3)).toHaveText("This is the last one.");
  // Paragraphs are kept; the line break inside the first one is not.
  const text = page.getByRole("region", { name: "Document text" });
  await expect(text.locator("p")).toHaveCount(2);
  await expect(text.locator("p").first()).toContainText(
    "end-to-end test. It has a line break in the middle of a paragraph.",
  );

  await page.getByRole("button", { name: "New document" }).click();
  await expect(
    page.getByRole("region", { name: "Recent documents" }).getByRole("button", { name: /^sample/ }),
  ).toContainText("Text file");
});

test("file inputs accept images; Take photo opens the rear camera", async ({ page }) => {
  await gotoHome(page);

  await page.getByRole("tab", { name: "Upload file" }).click();
  const fileInput = page.getByLabel("Choose a file");
  expect((await fileInput.getAttribute("accept"))?.split(",")).toContain("image/*");

  await page.getByRole("tab", { name: "Take photo" }).click();
  const panel = page.getByRole("tabpanel", { name: "Take photo" });
  await expect(panel).toBeVisible();
  const photo = panel.getByLabel("Take a photo of text");
  await expect(photo).toHaveAttribute("type", "file");
  await expect(photo).toHaveAttribute("accept", "image/*");
  await expect(photo).toHaveAttribute("capture", "environment");
  await expect(panel.getByRole("combobox", { name: "Text language" })).toBeVisible();

  // A non-image is rejected without running OCR.
  await photo.setInputFiles(SAMPLE);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "That file is not an image. Please take a photo or choose an image.",
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "What would you like to read?" }),
  ).toBeVisible();
});

test("Web page tab imports the article returned by /api/extract", async ({ page }) => {
  const requests: unknown[] = [];
  await page.route("**/api/extract", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        title: "A mocked article",
        text: "This article came from a mocked API. It has two sentences.",
        byline: null,
        siteName: null,
        url: "https://example.com/article",
      }),
    });
  });

  await gotoHome(page);
  await page.getByRole("tab", { name: "Web page" }).click();
  const panel = page.getByRole("tabpanel", { name: "Web page" });
  // Without a scheme, https:// is assumed.
  await panel.getByRole("textbox", { name: "Web page address" }).fill("example.com/article");
  await panel.getByRole("button", { name: "Get text" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "A mocked article" })).toBeFocused();
  await expect(page.locator("[data-sentence-index]")).toHaveCount(2);
  await expect(sentence(page, 0)).toHaveText("This article came from a mocked API.");
  expect(requests).toEqual([{ url: "https://example.com/article" }]);

  await page.getByRole("button", { name: "New document" }).click();
  await expect(
    page
      .getByRole("region", { name: "Recent documents" })
      .getByRole("button", { name: /^A mocked article/ }),
  ).toContainText("Web page");
});

test("Web page tab shows a friendly message when the address is blocked", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/extract", async (route) => {
    calls++;
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "blocked_host" }),
    });
  });

  await gotoHome(page);
  await page.getByRole("tab", { name: "Web page" }).click();
  const panel = page.getByRole("tabpanel", { name: "Web page" });
  const address = panel.getByRole("textbox", { name: "Web page address" });
  await address.fill("http://localhost:8080/admin");
  await panel.getByRole("button", { name: "Get text" }).click();

  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "That address can't be opened for safety reasons. Please try a public web page.",
  );
  expect(calls).toBe(1);
  // Still on Home, with the address kept so it can be corrected.
  await expect(
    page.getByRole("heading", { level: 1, name: "What would you like to read?" }),
  ).toBeVisible();
  await expect(address).toHaveValue("http://localhost:8080/admin");
  await expect(panel.getByRole("button", { name: "Get text" })).toBeEnabled();
});

test("Web page tab asks for an address when it is empty", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/extract", (route) => {
    calls++;
    return route.abort();
  });
  await gotoHome(page);
  await page.getByRole("tab", { name: "Web page" }).click();
  await page.getByRole("button", { name: "Get text" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Please enter a web page address.");
  await expect(page.getByRole("textbox", { name: "Web page address" })).toBeFocused();
  expect(calls).toBe(0);
});
