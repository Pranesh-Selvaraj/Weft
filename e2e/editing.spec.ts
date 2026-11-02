import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".badge")).toContainText(/live/i);
});

test("frame position edits are undoable through the inspector", async ({ page }) => {
  await page.locator(".frame-label").click();
  await expect(page.locator(".inspector h2")).toHaveText("Hero");

  const xInput = page.locator(".inspector .field").filter({ hasText: /^x$/ }).locator("input");
  await xInput.fill("120");
  await xInput.press("Enter");
  await expect(xInput).toHaveValue("120");

  const undo = page.locator(".history-buttons").getByRole("button", { name: "Undo" });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(xInput).toHaveValue("96");
});

test("new pages are empty, dashed, and removable", async ({ page }) => {
  await page.getByRole("button", { name: "+ Page" }).click();
  await expect(page.locator(".page-tab")).toHaveCount(2);
  await expect(page.locator(".stage")).toHaveClass(/is-empty/);
  await expect(page.locator(".page-empty-hint")).toContainText("Empty page");

  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator(".page-actions").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".page-tab")).toHaveCount(1);
  await expect(page.locator(".page-empty-hint")).toHaveCount(0);
});

test("Canvas/Page switch changes the workspace background and persists across reloads", async ({ page }) => {
  await expect(page.locator(".canvas-mode-switch button.is-active")).toHaveText("Canvas");
  await expect(page.locator(".canvas-backdrop")).toHaveCount(0);

  await page.locator(".canvas-mode-switch").getByRole("button", { name: "Page", exact: true }).click();
  await expect(page.locator(".canvas-mode-switch button.is-active")).toHaveText("Page");
  await expect(page.locator(".canvas-backdrop")).toBeVisible();

  await page.reload();
  await expect(page.locator(".canvas-mode-switch button.is-active")).toHaveText("Page");
  await expect(page.locator(".canvas-backdrop")).toBeVisible();

  await page.locator(".canvas-mode-switch").getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(page.locator(".canvas-backdrop")).toHaveCount(0);
});
