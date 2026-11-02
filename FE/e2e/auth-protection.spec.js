import { test, expect } from "@playwright/test";
import { registerAndEnterApp } from "./fixtures.js";

const BACKEND = `http://127.0.0.1:${process.env.PORT || 8080}`;
const PROTECTED =
  (process.env.E2E_EXPECT_PROTECTED_AUTH ?? process.env.AUTH_PROTECT_APP_APIS) === "true";

test("documents API matches the requested auth posture", async ({ page, request }) => {
  const unauthenticated = await request.get(`${BACKEND}/api/documents`);
  expect(
    unauthenticated.status(),
    PROTECTED
      ? "protected E2E must reject an unauthenticated app API request"
      : "open E2E keeps the documented unauthenticated documents contract",
  ).toBe(PROTECTED ? 401 : 200);

  await registerAndEnterApp(page);
  const token = await page.evaluate(() => localStorage.getItem("memvid-token"));
  expect(token, "register helper stores a real bearer token").toBeTruthy();

  const authenticated = await request.get(`${BACKEND}/api/documents`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(authenticated.status()).toBe(200);
});
