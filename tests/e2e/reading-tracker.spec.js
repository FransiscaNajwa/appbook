const { test, expect } = require("@playwright/test");

const passcode = "e2e-test-passcode";
const book = {
  id: "book-1",
  title: "Laut Bercerita",
  author: "Leila S. Chudori",
  genre: "Fiksi",
  total_pages: 300,
  status: "reading",
  reading_logs: [],
};

function installApiFixture(page, options = {}) {
  let state = { books: options.books ?? [{ ...book, reading_logs: [] }], settings: { goal: null, reminder: { enabled: false, time: "20:00", days: [1, 2, 3, 4, 5] } } };
  return page.route("**/api/**", async (route) => {
    const request = route.request();
    const headers = request.headers();
    if (headers["x-app-passcode"] !== passcode) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Unauthorized" }) });
    const url = new URL(request.url());
    const path = url.pathname.replace("/api", "");
    if (request.method() === "GET" && path === "/books") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ books: state.books }) });
    if (request.method() === "GET" && path === "/settings") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ settings: state.settings }) });
    if (request.method() === "POST" && path === "/books") {
      const body = JSON.parse(request.postData() || "{}");
      const created = { ...body, id: "book-2", status: "reading", reading_logs: [] };
      state.books.unshift(created);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ book: created }) });
    }
    if (request.method() === "POST" && path === "/books/book-1/logs") {
      const body = JSON.parse(request.postData() || "{}");
      state.books[0].reading_logs.push({ id: "log-1", page_reached: body.page_reached, note: body.note, logged_at: new Date().toISOString() });
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ log: state.books[0].reading_logs.at(-1) }) });
    }
    if (request.method() === "PATCH" && path === "/books/book-1") {
      state.books[0].status = JSON.parse(request.postData() || "{}").status;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ book: state.books[0] }) });
    }
    if (request.method() === "PATCH" && path === "/settings") {
      state.settings = { ...state.settings, ...JSON.parse(request.postData() || "{}") };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ settings: state.settings }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not found" }) });
  });
}

async function unlock(page) {
  await page.getByTestId("passcode-input").fill(passcode);
  await page.getByTestId("unlock-submit").click();
  await expect(page.getByTestId("book-list")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await installApiFixture(page);
  await page.goto("/");
});

test("unlocks and renders the collection from the API", async ({ page }) => {
  await unlock(page);
  await expect(page.getByRole("heading", { name: "Laut Bercerita" })).toBeVisible();
  await expect(page.getByText("Leila S. Chudori")).toBeVisible();
});

test("adds a book through the API", async ({ page }) => {
  await unlock(page);
  await page.getByTestId("add-book-button").click();
  await page.locator("#book-title").fill("Atomic Habits");
  await page.locator("#book-author").fill("James Clear");
  await page.locator("#book-genre").selectOption({ label: "Pengembangan diri" });
  await page.locator("#book-pages").fill("320");
  await page.locator("#book-form button[type=submit]").click();
  await expect(page.getByRole("heading", { name: "Atomic Habits" })).toBeVisible();
});

test("records a session and finishes a book", async ({ page }) => {
  await unlock(page);
  await page.getByRole("button", { name: "Catat" }).click();
  await expect(page.getByTestId("log-modal")).toBeVisible();
  await page.locator("#log-page").fill("142");
  await page.locator("#log-note").fill("Bagian yang sangat membekas.");
  await page.locator("#log-form button[type=submit]").click();
  await expect(page.getByText("Hal. 142 dari 300")).toBeVisible();
  await page.locator("[data-action='finish']").click();
  await page.locator(".filter-tab[data-filter='finished']").click();
  await expect(page.getByRole("heading", { name: "Laut Bercerita" })).toBeVisible();
});

test("shows validation feedback for an invalid page", async ({ page }) => {
  await unlock(page);
  await page.getByRole("button", { name: "Catat" }).click();
  await page.locator("#log-page").fill("301");
  await page.locator("#log-form button[type=submit]").click();
  await expect(page.getByText("Halaman harus antara 0 dan 300.")).toBeVisible();
});

test("saves a reading goal through the API", async ({ page }) => {
  await unlock(page);
  await page.getByRole("link", { name: "Target" }).click();
  await page.locator("#goal-type").selectOption("books");
  await page.locator("#goal-value").fill("3");
  await page.locator("#goal-form button[type=submit]").click();
  await expect(page.locator("#goal-value")).toHaveValue("3");
});

test("shows an error for an incorrect passcode", async ({ page }) => {
  await page.getByTestId("passcode-input").fill("wrong-passcode");
  await page.getByTestId("unlock-submit").click();
  await expect(page.locator("#unlock-error")).toHaveText("Passcode tidak cocok.");
});

test("shows a friendly error when the API is unavailable", async ({ page }) => {
  await page.unroute("**/api/**");
  await page.route("**/api/**", (route) => route.abort());
  await page.getByTestId("passcode-input").fill(passcode);
  await page.getByTestId("unlock-submit").click();
  await expect(page.locator("#unlock-error")).toHaveText("Backend belum terhubung. Periksa konfigurasi Netlify.");
});

test("shows the empty collection state", async ({ page }) => {
  await page.unroute("**/api/**");
  await installApiFixture(page, { books: [] });
  await page.goto("/");
  await unlock(page);
  await expect(page.getByText("Belum ada buku di rak senjamu.")).toBeVisible();
});
