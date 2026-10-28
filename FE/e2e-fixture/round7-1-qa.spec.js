import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const evidence = (name) => `../docs/ui-ux-v4-design/round7-qa-evidence/${name}.png`;

async function noHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
}

async function centerIsClickable(locator) {
  await locator.scrollIntoViewIfNeeded();
  const ownsCenter = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit && (hit === element || element.contains(hit)));
  });
  expect(ownsCenter).toBe(true);
}

async function contrastOf(locator) {
  return locator.evaluate((element) => {
    const parse = (value) => {
      const raw = String(value).trim();
      const parts = raw.match(/[\d.]+/g)?.map(Number) || [];
      if (raw.startsWith("color(srgb")) {
        return { r: (parts[0] || 0) * 255, g: (parts[1] || 0) * 255, b: (parts[2] || 0) * 255, a: parts[3] ?? 1 };
      }
      return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: parts[3] ?? 1 };
    };
    const mix = (front, back, opacity = 1) => {
      const alpha = front.a * opacity;
      return {
        r: front.r * alpha + back.r * (1 - alpha),
        g: front.g * alpha + back.g * (1 - alpha),
        b: front.b * alpha + back.b * (1 - alpha),
        a: 1,
      };
    };
    const chain = [];
    for (let node = element; node; node = node.parentElement) chain.unshift(node);
    let background = { r: 255, g: 255, b: 255, a: 1 };
    for (const node of chain) {
      const style = getComputedStyle(node);
      background = mix(parse(style.backgroundColor), background, Number(style.opacity));
    }
    const style = getComputedStyle(element);
    const foreground = mix(parse(style.color), background, Number(style.opacity));
    const luminance = ({ r, g, b }) => {
      const linear = [r, g, b].map((channel) => {
        const s = channel / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const l1 = luminance(foreground);
    const l2 = luminance(background);
    return {
      ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05),
      color: style.color,
      backgroundColor: style.backgroundColor,
      opacity: style.opacity,
    };
  });
}

test.describe("Round 7.1 populated Quiz browser evidence", () => {
  test("full save-failure recovery, pending/graded result, original ordinals and review-plan practice contract", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/r71qa.html?view=taking");
    await expect(page.getByRole("heading", { name: "Hệ điều hành hiện đại — kiểm tra giữa kỳ" })).toBeVisible();

    // Restored server answer at question 2 remains selected after navigation.
    await page.getByRole("button", { name: "Câu 2 đã trả lời" }).click();
    await expect(page.getByRole("radio", { name: "B" })).toBeChecked();
    await page.getByRole("button", { name: "Câu 1 chưa trả lời" }).click();
    await page.locator("label.answer-option").filter({ hasText: /^A/ }).click();
    await page.getByRole("button", { name: "Câu sau" }).click();
    await expect(page.getByRole("radio", { name: "B" })).toBeChecked();

    // Edit a short answer, then force the flush-before-submit save to reject.
    await page.getByRole("button", { name: "Câu 10 chưa trả lời" }).click();
    await page.evaluate(() => window.__qa.forceNextSaveFail());
    await page.getByRole("textbox").fill("Câu trả lời ngắn đã chỉnh sửa");
    await expect(page.locator('[aria-live="polite"]')).toContainText(/đang lưu|câu chưa lưu được|đã trả lời/);
    await page.screenshot({ path: evidence("quiz-taking-populated-1440-light"), fullPage: true });

    await page.getByRole("button", { name: "Nộp bài", exact: true }).click();
    let submitDialog = page.getByRole("dialog", { name: "Nộp bài?" });
    await submitDialog.getByRole("button", { name: "Nộp bài" }).click();
    await expect(page.getByRole("alert")).toContainText("save_failed");
    expect(await page.evaluate(() => window.__qa.submitCallCount())).toBe(0);
    await expect(page.locator('[aria-live="polite"]')).toContainText(/\d+ câu chưa lưu được/);

    // Retry the same confirmation: save succeeds and submit occurs exactly once.
    await page.getByRole("button", { name: "Nộp bài", exact: true }).click();
    submitDialog = page.getByRole("dialog", { name: "Nộp bài?" });
    await submitDialog.getByRole("button", { name: "Nộp bài" }).click();
    await expect(page.getByText("Đang chấm", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => window.__qa.submitCallCount())).toBe(1);
    await expect(page.getByText("8 / 10", { exact: true })).toHaveCount(0);
    await expect(page.locator(".seal-meter--mastered")).toHaveCount(0);
    await expect(page.getByText(/Câu hỏi số 1:/)).toHaveCount(0);
    await expect(page.getByText(/Giải thích chi tiết cho câu 1/)).toHaveCount(0);
    await expect(page.getByText("đáp án mẫu", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: evidence("quiz-result-pending-1440-light"), fullPage: true });

    await page.evaluate(() => window.__qa.grade());
    await expect(page.getByRole("button", { name: "Xem lại 2 câu cần ôn" })).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: evidence("quiz-result-graded-1440-light"), fullPage: true });
    await page.getByRole("button", { name: "Xem lại 2 câu cần ôn" }).click();
    await expect(page.getByRole("complementary", { name: "Câu cần xem lại" })).toContainText("Câu 4");
    await expect(page.getByRole("complementary", { name: "Câu cần xem lại" })).toContainText("Câu 9");
    await expect(page.locator(".quiz-wrong-review__content .font-mono").first()).toHaveText("04");
    await page.screenshot({ path: evidence("wrong-review-original-ordinals-1440-light"), fullPage: true });

    // Mobile detail navigation must preserve those same original ordinals.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".quiz-wrong-review__content .font-mono").first()).toHaveText("04");
    await page.getByRole("button", { name: "Câu cần ôn tiếp theo" }).click();
    await expect(page.locator(".quiz-wrong-review__content .font-mono").first()).toHaveText("09");
    // The desktop next-step card is hidden on narrow screens, so the compact
    // contextual action must remain discoverable while reviewing the answer.
    const compactReviewPlan = page.locator(".quiz-wrong-review__compact-review-link");
    await expect(compactReviewPlan).toBeVisible();
    await expect(compactReviewPlan).toHaveAttribute("href", "/app/study/review/attempt-qa-1");
    await page.screenshot({ path: evidence("wrong-review-contextual-390-light"), fullPage: true });
    await compactReviewPlan.click();
    await expect(page.getByRole("heading", { name: "Bộ nhớ: phân trang theo yêu cầu" })).toBeVisible();
    await expect(page.getByText("Đọc lại phần phân trang theo yêu cầu")).toBeVisible();
    await page.screenshot({ path: evidence("review-guide-populated-390-light"), fullPage: true });

    await page.getByRole("button", { name: "Luyện ngay (5 câu)" }).click();
    await expect.poll(() => page.evaluate(() => window.__qa.practiceCalls())).toEqual([
      { review_item_id: "ri-1", question_count: 5, difficulty: "easy" },
    ]);
  });
});

test.describe("Round 7.1 destructive confirmation", () => {
  test("shared dialog transactions, focus behavior, exact IDs, errors and same-instance reset", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/r71qa.html?view=destructive");
    let dialog = page.getByRole("dialog");
    let confirm = dialog.getByRole("button", { name: "Xóa sơ đồ" });
    await expect(dialog).toContainText("Sơ đồ Alpha");
    await expect(dialog).toContainText("toàn bộ nội dung liên quan");
    await expect(confirm).toBeDisabled();
    await page.screenshot({ path: evidence("destructive-confirm-unchecked-1024-light"), fullPage: true });
    await dialog.getByRole("checkbox").check();
    await expect(confirm).toBeEnabled();
    await centerIsClickable(confirm);
    await page.screenshot({ path: evidence("destructive-confirm-checked-1024-light"), fullPage: true });

    // Cancel and Escape are both zero-request exits; Escape restores trigger focus.
    await dialog.getByRole("button", { name: "Huỷ" }).click();
    expect(await page.evaluate(() => window.__qa.deleteLog())).toEqual([]);
    const alphaTrigger = page.getByRole("button", { name: "Xóa sơ đồ Alpha" });
    await alphaTrigger.click();
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => window.__qa.deleteLog())).toEqual([]);
    await expect(alphaTrigger).toBeFocused();

    // Real browser focus trap: repeated Tab cannot leave the dialog.
    await alphaTrigger.click();
    dialog = page.getByRole("dialog");
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    await dialog.getByRole("checkbox").check();
    confirm = dialog.getByRole("button", { name: "Xóa sơ đồ" });
    await confirm.evaluate((button) => { button.click(); button.click(); });
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => window.__qa.deleteLog())).toEqual([{ kind: "mindmaps", id: "map-alpha" }]);

    // Same mounted dialog, second target: acknowledgement resets and the exact second ID is used.
    await page.getByRole("button", { name: "Xóa sơ đồ Beta" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Sơ đồ Beta");
    await expect(dialog.getByRole("checkbox")).not.toBeChecked();
    await expect(dialog.getByRole("button", { name: "Xóa sơ đồ" })).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Xóa sơ đồ" }).click();
    expect(await page.evaluate(() => window.__qa.deleteLog())).toEqual([
      { kind: "mindmaps", id: "map-alpha" },
      { kind: "mindmaps", id: "map-beta" },
    ]);

    // Failed summary delete stays open and reports error instead of false success.
    await page.evaluate(() => window.__qa.setDeleteFailure(true));
    await page.getByRole("button", { name: "Xóa tóm tắt Gamma" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Tóm tắt Gamma");
    await expect(dialog).toContainText("Bản tóm tắt này sẽ bị xóa vĩnh viễn");
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Xóa tóm tắt" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Không xóa được tóm tắt");
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => window.__qa.deleteLog()).then((x) => x.at(-1))).toEqual({ kind: "summaries", id: "summary-gamma" });
  });

  test("actual ChatArea consumer path performs one conversation DELETE only after acknowledgement", async ({ page }) => {
    await page.goto("/r71qa.html?view=chat");
    const menu = page.getByRole("button", { name: "Tùy chọn cuộc trò chuyện" });
    await menu.click();
    await page.getByRole("button", { name: "Xóa lịch sử chat" }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Xóa lịch sử chat" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Huỷ" }).click();
    expect(await page.evaluate(() => window.__qa.deleteLog())).toEqual([]);

    await menu.click();
    await page.getByRole("button", { name: "Xóa lịch sử chat" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Xóa lịch sử chat" }).evaluate((button) => { button.click(); button.click(); });
    await expect(dialog).toHaveCount(0);
    const requests = await page.evaluate(() => window.__qa.deleteLog());
    expect(requests).toHaveLength(1);
    expect(requests[0].kind).toBe("conversations");
    expect(requests[0].id).toBeTruthy();
  });
});

const matrix = [
  [1440, 900], [1024, 768], [820, 1180], [800, 900], [768, 1024], [390, 844], [320, 568],
];

test("responsive light/dark matrix: no overflow, reachable controls, distinct pending/graded states and Profile page", async ({ page }) => {
  test.setTimeout(180_000);
  for (const [width, height] of matrix) {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height });
      await page.goto(`/r71qa.html?view=taking&theme=${theme}`);
      await expect(page.getByRole("button", { name: "Nộp bài", exact: true })).toBeVisible();
      await expect(page.locator(".quiz-question-card")).toBeVisible();
      await noHorizontalOverflow(page);
      await centerIsClickable(page.getByRole("button", { name: "Nộp bài", exact: true }));
      await page.getByRole("button", { name: "Câu sau" }).focus();
      expect(await page.getByRole("button", { name: "Câu sau" }).evaluate((el) => el.matches(":focus-visible"))).toBe(true);

      await page.goto(`/r71qa.html?view=pending&theme=${theme}`);
      await expect(page.getByText("Đang chấm", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("8 / 10", { exact: true })).toHaveCount(0);
      await expect(page.locator(".seal-meter--mastered")).toHaveCount(0);
      await noHorizontalOverflow(page);

      await page.goto(`/r71qa.html?view=graded&theme=${theme}`);
      const review = page.getByRole("button", { name: "Xem lại 2 câu cần ôn" });
      await expect(review).toBeVisible();
      await review.click();
      await expect(page.locator("body")).toContainText("Câu 4");
      await expect(page.locator("body")).toContainText("Câu 9");
      const contextualPlan = page.locator(".quiz-wrong-review__compact-review-link");
      if (width <= 1000) await expect(contextualPlan).toBeVisible();
      else await expect(contextualPlan).toBeHidden();
      await noHorizontalOverflow(page);

      await page.goto(`/r71qa.html?view=profile&theme=${theme}`);
      await expect(page.getByRole("heading", { name: "Hồ sơ tài khoản" })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await noHorizontalOverflow(page);

      await page.goto(`/r71qa.html?view=destructive&theme=${theme}`);
      const destructive = page.getByRole("dialog").getByRole("button", { name: "Xóa sơ đồ" });
      await page.getByRole("dialog").getByRole("checkbox").check();
      await expect(destructive).toBeEnabled();
      await centerIsClickable(destructive);
      await noHorizontalOverflow(page);
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/r71qa.html?view=profile&theme=dark");
  await page.screenshot({ path: evidence("profile-1440-dark"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/r71qa.html?view=profile&theme=light");
  await page.screenshot({ path: evidence("profile-390-light"), fullPage: true });

  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/r71qa.html?view=taking&theme=light");
  await page.screenshot({ path: evidence("quiz-rail-820-light"), fullPage: true });
  await page.goto("/r71qa.html?view=graded&theme=dark");
  await page.getByRole("button", { name: "Xem lại 2 câu cần ôn" }).click();
  await page.screenshot({ path: evidence("wrong-review-contextual-820-dark"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/r71qa.html?view=destructive&theme=dark");
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page.waitForTimeout(250);
  await page.screenshot({ path: evidence("destructive-confirm-checked-390-dark"), fullPage: true });

  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/r71qa.html?view=profile&theme=light");
  await page.screenshot({ path: evidence("profile-320-light"), fullPage: true });
  await page.goto("/r71qa.html?view=review&theme=dark");
  await page.screenshot({ path: evidence("review-guide-320-dark"), fullPage: true });
  await page.goto("/r71qa.html?view=taking&theme=light");
  await page.getByRole("button", { name: "Nộp bài", exact: true }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: evidence("submit-confirm-320-light"), fullPage: true });

  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/r71qa.html?view=review&theme=light");
  await page.screenshot({ path: evidence("review-guide-820-light"), fullPage: true });
});

test("visual metrics: tablet rail containment and destructive action contrast", async ({ page }) => {
  const report = { generatedAt: new Date().toISOString(), rails: [], destructive: [] };
  for (const width of [768, 780, 800, 820, 1001, 1010, 1024, 1279]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/r71qa.html?view=taking");
    const geometry = await page.locator(".quiz-question-rail").evaluate((rail) => {
      const style = getComputedStyle(rail);
      const rect = rail.getBoundingClientRect();
      const content = {
        left: rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
        right: rect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
      };
      const buttons = [...rail.querySelectorAll(".quiz-question-index")].map((button) => {
        const box = button.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width, height: box.height };
      });
      return {
        width: innerWidth,
        rail: { left: rect.left, right: rect.right, width: rect.width },
        content,
        buttons,
        contained: buttons.every((box) => box.left >= content.left - 0.5 && box.right <= content.right + 0.5),
        minimumTarget: Math.min(...buttons.flatMap((box) => [box.width, box.height])),
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    report.rails.push(geometry);
    expect.soft(geometry.contained, `rail containment at ${width}px`).toBe(true);
    expect.soft(geometry.minimumTarget, `question target at ${width}px`).toBeGreaterThanOrEqual(44);
    expect.soft(geometry.pageOverflow, `global overflow at ${width}px`).toBeLessThanOrEqual(1);
  }

  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/r71qa.html?view=destructive&theme=${theme}`);
    const dialog = page.getByRole("dialog");
    const action = dialog.getByRole("button", { name: "Xóa sơ đồ" });
    const cancel = dialog.getByRole("button", { name: "Huỷ" });
    const acknowledgement = dialog.locator(".destructive-confirm__ack");
    const disabled = await contrastOf(action);
    await dialog.getByRole("checkbox").check();
    await page.waitForTimeout(250);
    const enabled = await contrastOf(action);
    await action.hover();
    await page.waitForTimeout(250);
    const hover = await contrastOf(action);
    const box = await action.boundingBox();
    const cancelBox = await cancel.boundingBox();
    const acknowledgementBox = await acknowledgement.boundingBox();
    report.destructive.push({ theme, disabled, enabled, hover, box, cancelBox, acknowledgementBox });
    expect.soft(enabled.ratio, `${theme} destructive enabled contrast`).toBeGreaterThanOrEqual(4.5);
    expect.soft(hover.ratio, `${theme} destructive hover contrast`).toBeGreaterThanOrEqual(4.5);
    expect.soft(box?.height || 0, `${theme} destructive target height`).toBeGreaterThanOrEqual(44);
    expect.soft(cancelBox?.height || 0, `${theme} destructive cancel height`).toBeGreaterThanOrEqual(44);
    expect.soft(acknowledgementBox?.height || 0, `${theme} acknowledgement target height`).toBeGreaterThanOrEqual(44);
  }

  const outputDir = resolve("..", "docs", "ui-ux-v4-design", "round7-qa-evidence");
  mkdirSync(outputDir, { recursive: true });
  const label = process.env.R71_METRICS_LABEL || "final";
  writeFileSync(resolve(outputDir, `visual-metrics-${label}.json`), `${JSON.stringify(report, null, 2)}\n`);
});

test("visual metrics: mobile targets, local overflow and Quiz semantic contrast", async ({ page }) => {
  test.setTimeout(90_000);
  const report = { generatedAt: new Date().toISOString(), targets: {}, contrast: {}, layouts: {} };
  const recordTargets = async (key, locators) => {
    const boxes = [];
    for (const locator of locators) boxes.push(await locator.boundingBox());
    report.targets[key] = boxes;
    for (const box of boxes) {
      expect.soft(box?.height || 0, `${key} height`).toBeGreaterThanOrEqual(44);
      expect.soft(box?.width || 0, `${key} width`).toBeGreaterThanOrEqual(44);
    }
  };

  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/r71qa.html?view=profile");
  const back = page.getByRole("button", { name: "Quay lại" });
  const heading = page.getByRole("heading", { name: "Hồ sơ tài khoản" });
  const edit = page.getByRole("button", { name: /Chỉnh sửa hồ sơ/ });
  await recordTargets("profile-edit", [edit]);
  const [backBox, headingBox] = await Promise.all([back.boundingBox(), heading.boundingBox()]);
  report.layouts.profileHeader = { backBox, headingBox };
  expect.soft(backBox?.height || 0, "profile Back target height").toBeGreaterThanOrEqual(44);
  expect.soft(backBox?.width || 0, "profile Back target width").toBeGreaterThanOrEqual(44);
  expect.soft((backBox?.x || 0) + (backBox?.width || 0)).toBeLessThanOrEqual(headingBox?.x || 0);
  await edit.click();
  await expect(page.locator("#hs-firstname")).toBeVisible();
  await recordTargets("profile-form-actions", [
    page.getByRole("button", { name: "Huỷ" }).last(),
    page.getByRole("button", { name: "Lưu thay đổi" }),
  ]);

  await page.goto("/r71qa.html?view=graded");
  await page.getByRole("button", { name: "Xem lại 2 câu cần ôn" }).click();
  await recordTargets("wrong-review-arrows", [
    page.getByRole("button", { name: "Câu cần ôn trước" }),
    page.getByRole("button", { name: "Câu cần ôn tiếp theo" }),
  ]);

  await page.goto("/r71qa.html?view=review");
  const practice = page.getByRole("button", { name: "Luyện ngay (5 câu)" });
  const customize = page.getByRole("button", { name: "Tùy chỉnh" });
  await recordTargets("review-actions", [practice, customize]);
  await customize.click();
  const customizeDialog = page.getByRole("dialog", { name: "Tùy chỉnh luyện tập" });
  const builderPills = await customizeDialog.locator(".pill-tab").all();
  expect(builderPills.length).toBeGreaterThan(0);
  await recordTargets("question-builder-pills", builderPills);
  await recordTargets("practice-modal-actions", [
    customizeDialog.getByRole("button", { name: "Huỷ" }),
    customizeDialog.getByRole("button", { name: "Tạo câu luyện tập" }),
  ]);

  await page.goto("/r71qa.html?view=taking");
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.getByRole("button", { name: "Câu 10 chưa trả lời" }).click();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("textbox").fill("khongcokhoangtrang".repeat(40));
  const questionCard = page.locator(".quiz-question-card");
  report.layouts.questionCardOverflow = await questionCard.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect.soft(report.layouts.questionCardOverflow).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Nộp bài", exact: true }).click();
  const submitDialog = page.getByRole("dialog", { name: "Nộp bài?" });
  await recordTargets("submit-modal-actions", [
    submitDialog.getByRole("button", { name: "Quay lại làm tiếp" }),
    submitDialog.getByRole("button", { name: "Nộp bài" }),
  ]);

  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto(`/r71qa.html?view=tones&theme=${theme}`);
    const verdicts = ["correct", "partial", "incorrect"].map((value) =>
      page.locator(`.quiz-verdict-badge[data-verdict="${value}"]`).first());
    report.contrast[theme] = { verdicts: [] };
    for (const verdict of verdicts) report.contrast[theme].verdicts.push(await contrastOf(verdict));
    for (const metric of report.contrast[theme].verdicts) {
      expect.soft(metric.ratio, `${theme} verdict contrast`).toBeGreaterThanOrEqual(4.5);
    }
    await page.getByRole("button", { name: "Xem lại 3 câu cần ôn" }).click();
    const railTag = page.locator(".quiz-wrong-review__rail small").first();
    const railNumber = page.locator(".quiz-wrong-review__rail > button > span").first();
    report.contrast[theme].railTag = await contrastOf(railTag);
    report.contrast[theme].railNumber = await contrastOf(railNumber);
    expect.soft(report.contrast[theme].railTag.ratio, `${theme} rail tag contrast`).toBeGreaterThanOrEqual(4.5);
    expect.soft(report.contrast[theme].railNumber.ratio, `${theme} rail number contrast`).toBeGreaterThanOrEqual(4.5);

    await page.goto(`/r71qa.html?view=taking&theme=${theme}`);
    report.contrast[theme].processing = await contrastOf(page.locator(".quiz-question-card .badge-processing"));
    report.contrast[theme].completedQuestion = await contrastOf(page.locator('.quiz-question-index[aria-label*="đã trả lời"]').first());
    expect.soft(report.contrast[theme].processing.ratio, `${theme} processing contrast`).toBeGreaterThanOrEqual(4.5);
    expect.soft(report.contrast[theme].completedQuestion.ratio, `${theme} completed question contrast`).toBeGreaterThanOrEqual(4.5);
  }

  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/r71qa.html?view=review");
  const reviewCard = page.locator(".quiz-review-plan-item").first();
  report.layouts.review820 = await reviewCard.evaluate((card) => {
    const cardBox = card.getBoundingClientRect();
    const actions = [...card.querySelectorAll("button")].map((button) => {
      const box = button.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    });
    const contained = actions.every((box) => box.left >= cardBox.left && box.right <= cardBox.right && box.top >= cardBox.top && box.bottom <= cardBox.bottom);
    const overlap = actions.some((box, i) => actions.slice(i + 1).some((other) =>
      box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top));
    return { overflow: card.scrollWidth - card.clientWidth, actions, contained, overlap };
  });
  expect.soft(report.layouts.review820.overflow).toBeLessThanOrEqual(1);
  expect.soft(report.layouts.review820.contained).toBe(true);
  expect.soft(report.layouts.review820.overlap).toBe(false);

  const outputDir = resolve("..", "docs", "ui-ux-v4-design", "round7-qa-evidence");
  mkdirSync(outputDir, { recursive: true });
  const label = process.env.R71_METRICS_LABEL || "final";
  writeFileSync(resolve(outputDir, `interaction-metrics-${label}.json`), `${JSON.stringify(report, null, 2)}\n`);
});
