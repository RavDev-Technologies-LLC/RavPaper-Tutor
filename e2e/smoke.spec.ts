import { test, expect } from "@playwright/test";
import pg from "pg";

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://rp:rp@localhost/rp_e2e";
const id = Date.now().toString(36);
const email = `e2e_${id}@example.com`;
const password = "e2e-correct-horse-battery";
const text = "This methods chapter describes a longitudinal survey of doctoral candidates and the statistical models used to estimate completion.\n".repeat(3);

test("register, upload, analyze, survive reload, and log out", async ({ page, context }) => {
  await page.goto("/register");
  await page.getByTestId("input-fullname").fill("E2E User");
  await page.getByTestId("input-email").fill(email);
  await page.getByTestId("input-username").fill(`e2e_${id}`);
  await page.getByTestId("input-password").fill(password);
  await page.getByTestId("input-confirm-password").fill(password);
  await page.getByTestId("button-register").click();
  await expect(page).not.toHaveURL(/register/);

  // No tokens in web storage; refresh token is an httpOnly cookie.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toMatch(/token|eyJ/i);
  const rt = (await context.cookies()).find((c) => c.name === "rp_rt");
  expect(rt?.httpOnly).toBe(true);
  expect(rt?.sameSite).toBe("Strict");

  // Grant a credit directly (payments are covered by integration tests).
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  await db.query(`update users set review_credits = 1 where email = $1`, [email]);
  await db.end();

  await page.goto("/upload");
  await page.getByTestId("input-title").fill("E2E Methods Chapter");
  await page.getByTestId("select-submission-type").click();
  await page.getByTestId("option-dissertation").click();
  await page.getByTestId("input-file").setInputFiles({ name: "methods.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await page.getByTestId("button-upload").click();
  await expect(page.getByTestId("text-document-title")).toHaveText("E2E Methods Chapter");

  // Session survives a full reload (access token is re-minted from the cookie).
  await page.reload();
  await expect(page.getByTestId("text-document-title")).toHaveText("E2E Methods Chapter");

  await page.getByTestId("page-document-detail").getByTestId("link-run-analysis").click();
  for (const engine of ["rubric_alignment", "statistics", "literature_review", "anthropomorphism", "formatting"]) {
    await page.getByTestId(`checkbox-engine-${engine}`).click();
  }
  await expect(page.getByText("Source Similarity").first()).toBeVisible();
  await page.getByTestId("button-run-analysis").click();
  await expect(page.getByTestId("text-overall-score")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Not checked against the web/).first()).toBeVisible();

  await page.getByTestId("button-logout").click();
  await expect(page).toHaveURL(/login/);
  expect((await context.cookies()).find((c) => c.name === "rp_rt")).toBeUndefined();
  await page.goto("/documents");
  await expect(page).toHaveURL(/login/);
});
