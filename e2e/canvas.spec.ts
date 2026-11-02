import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".stage")).toBeVisible();
  await expect(page.locator(".badge")).toContainText(/live/i);
});

test("canvas defaults to the dotted workspace with labeled frames", async ({ page }) => {
  await expect(page.locator(".canvas-mode-switch button.is-active")).toHaveText("Canvas");
  await expect(page.locator(".canvas-backdrop")).toHaveCount(0);
  await expect(page.locator(".frame-label")).toContainText("Hero");

  await page.locator(".frame-label").click();
  await expect(page.locator(".inspector h2")).toHaveText("Hero");
  await expect(page.locator(".layer-row.is-selected .layer-name")).toHaveText("Hero");
});

test("page-scope hover highlights the frame; scope entry exposes children", async ({ page }) => {
  const heading = page.locator('[data-node-type="text"]').filter({ hasText: "Design files agents can" });
  await heading.hover();
  await expect(page.locator(".frame-label.is-hovered")).toContainText("Hero");
  await expect(page.locator(".hover-box")).toBeVisible();
  await expect(page.locator(".hover-label")).toHaveCount(0);

  await heading.dblclick();
  await expect(page.locator(".canvas-breadcrumb")).toContainText("Hero");
  await expect(page.locator(".layer-row.is-selected .layer-name")).toHaveText("Heading");

  const body = page.locator('[data-node-type="text"]').filter({ hasText: "Weft puts the design" });
  await body.hover();
  await expect(page.locator(".hover-label")).toHaveText("Body");
  await page.keyboard.press("Escape");
  await expect(page.locator(".canvas-breadcrumb")).toHaveCount(0);
  await expect(page.locator(".layer-row.is-selected .layer-name")).toHaveText("Hero");
});

test("Space-drag pans a zoomed canvas and zoom is cursor-anchored", async ({ page }) => {
  await page.locator(".zoom-value").click();
  await expect(page.locator(".zoom-value")).toHaveText("100%");

  const canvas = page.locator(".canvas");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("canvas has no bounds");
  await canvas.click({ position: { x: 10, y: 10 } });
  const before = await canvas.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }));
  await page.mouse.move(canvasBox.x + 700, canvasBox.y + 500);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 360, canvasBox.y + 260, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  const after = await canvas.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }));
  expect(after.left).toBeGreaterThan(before.left);
  expect(after.top).toBeGreaterThan(before.top);

  await page.locator(".zoom-value").click();
  await page.evaluate(() => {
    const element = document.querySelector(".canvas");
    if (element) {
      element.scrollLeft = 0;
      element.scrollTop = 0;
    }
  });
  const heading = page.locator('[data-node-type="text"]').filter({ hasText: "Design files agents can" });
  const headingBox = await heading.boundingBox();
  if (!headingBox) throw new Error("heading has no bounds");
  const cursor = { x: headingBox.x + 80, y: headingBox.y + 35 };
  const beforeZoom = await heading.boundingBox();
  await page.mouse.move(cursor.x, cursor.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await expect(page.locator(".zoom-value")).toHaveText("110%");
  const afterZoom = await heading.boundingBox();
  if (!beforeZoom || !afterZoom) throw new Error("heading bounds disappeared");
  expect(afterZoom.x).toBeLessThan(beforeZoom.x);
  expect(afterZoom.y).toBeLessThan(beforeZoom.y);
});
