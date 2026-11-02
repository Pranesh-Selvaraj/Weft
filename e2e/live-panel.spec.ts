import { test, expect } from "@playwright/test";

test("live panel shows the actual runtime endpoints", async ({ page }) => {
  await page.goto("/");
  await page.locator(".live-toggle").click();
  await expect(page.locator(".live-panel")).toBeVisible();
  await expect(page.locator(".endpoint-value").filter({ hasText: "http://127.0.0.1:5260" })).toHaveCount(3);
  await expect(page.locator(".endpoint-label").filter({ hasText: "Health check" })).toBeVisible();
  await expect(page.locator(".endpoint-label").filter({ hasText: "Design file" })).toBeVisible();
  await page.getByRole("button", { name: "Close live session panel" }).click();
  await expect(page.locator(".live-panel")).toHaveCount(0);
});
