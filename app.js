const API_BASE = "/api";
const PASSCODE_KEY = "reading-tracker-passcode";
const CACHE_KEY = "reading-tracker-cache";
const genres = ["Fiksi", "Non-fiksi", "Pengembangan diri", "Biografi", "Romansa", "Misteri", "Fantasi", "Sejarah", "Lainnya"];
const initialData = { books: [], goal: null, reminder: { enabled: false, time: "20:00", days: [1, 2, 3, 4, 5] } };
let data = loadCache();
let activeFilter = "reading";
let activeBookId = null;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function loadCache() {
  try { return { ...initialData, ...JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") }; }
  catch { return structuredClone(initialData); }
}
function saveCache() { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); }
function normalizeBook(book) {
  return { ...book, totalPages: book.total_pages ?? book.totalPages ?? null, finishedAt: book.finished_at ?? book.finishedAt, logs: (book.reading_logs || book.logs || []).map((log) => ({ ...log, page: log.page_reached ?? log.page, loggedAt: log.logged_at ?? log.loggedAt })) };
}
function escapeText(value) { return String(value ?? ""); }
function latestLog(book) { return [...book.logs].sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt))[0]; }
function latestPage(book) { return latestLog(book)?.page ?? 0; }
function progress(book) { return book.totalPages ? Math.min(100, Math.round(latestPage(book) / book.totalPages * 100)) : null; }
function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 3000); }
function openModal(id) { $(id).classList.remove("hidden"); document.body.style.overflow = "hidden"; }
function closeModals() { $$(".modal").forEach((modal) => modal.classList.add("hidden")); document.body.style.overflow = ""; }
function setLoading(loading) { $("#book-list").classList.toggle("loading", loading); }
function setOffline(offline) { $("#offline-pill").classList.toggle("offline", offline); $("#offline-pill").innerHTML = `<i></i> ${offline ? "Offline" : "Online"}`; }

async function api(path, options = {}) {
  const passcode = localStorage.getItem(PASSCODE_KEY);
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { "Content-Type": "application/json", "X-App-Passcode": passcode || "", ...(options.headers || {}) } });
  let body = null;
  try { body = await response.json(); } catch { /* empty response */ }
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
  return body;
}
async function syncFromApi() {
  const [bookResponse, settingsResponse] = await Promise.all([api("/books"), api("/settings")]);
  data.books = (bookResponse.books || []).map(normalizeBook);
  data.goal = settingsResponse.settings?.goal || null;
  data.reminder = settingsResponse.settings?.reminder || initialData.reminder;
  saveCache();
}
async function persistSettings() {
  const response = await api("/settings", { method: "PATCH", body: JSON.stringify({ goal: data.goal, reminder: data.reminder }) });
  data.goal = response.settings.goal || null;
  data.reminder = response.settings.reminder || initialData.reminder;
  saveCache();
}
async function unlockWithApi(passcode) {
  localStorage.setItem(PASSCODE_KEY, passcode);
  try { await syncFromApi(); return true; }
  catch (error) { localStorage.removeItem(PASSCODE_KEY); throw error; }
}
function showApp() { $("#lock-screen").classList.add("hidden"); $("#main-app").classList.remove("hidden"); render(); }

$("#unlock-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#passcode").value.trim();
  if (!input) return;
  const button = event.submitter;
  button.disabled = true;
  $("#unlock-error").textContent = "";
  try { await unlockWithApi(input); $("#passcode").value = ""; showApp(); }
  catch (error) { $("#unlock-error").textContent = error.message === "Unauthorized" ? "Passcode tidak cocok." : "Backend belum terhubung. Periksa konfigurasi Netlify."; }
  finally { button.disabled = false; }
});
$("#lock-button").addEventListener("click", () => { localStorage.removeItem(PASSCODE_KEY); $("#main-app").classList.add("hidden"); $("#lock-screen").classList.remove("hidden"); });

async function refreshData() {
  setLoading(true);
  try { await syncFromApi(); render(); setOffline(false); }
  catch (error) { setOffline(true); showToast(`Gagal memuat data: ${error.message}`); }
  finally { setLoading(false); }
}
function render() { renderBooks(); renderStats(); renderGoal(); renderSettings(); route(location.hash.slice(1) || "koleksi"); }
function renderBooks() {
  const books = data.books.filter((book) => activeFilter === "all" || book.status === activeFilter);
  $("#reading-count").textContent = `${data.books.filter((book) => book.status === "reading").length} buku`;
  $("#reading-heading-count").textContent = books.length;
  $("#book-list").innerHTML = books.length ? books.map(bookCard).join("") : `<div class="empty-state"><div class="empty-icon">⌑</div><h3>${activeFilter === "reading" ? "Belum ada buku di rak senjamu." : "Belum ada buku di sini."}</h3><p class="muted">${activeFilter === "reading" ? "Yuk, tambahkan buku pertamamu dan mulai mencatat." : "Perjalananmu akan muncul di sini."}</p><button class="button primary" data-action="add-book">Tambah buku</button></div>`;
  $$("[data-action='add-book']").forEach((button) => button.addEventListener("click", () => openModal("#book-modal")));
  $$("[data-action='log']").forEach((button) => button.addEventListener("click", () => openLog(button.dataset.id)));
  $$("[data-action='finish']").forEach((button) => button.addEventListener("click", () => finishBook(button.dataset.id)));
}
function bookCard(book) {
  const percent = progress(book); const latest = latestLog(book);
  const coverClass = ["Fantasi", "Misteri"].includes(book.genre) ? "purple" : ["Pengembangan diri", "Biografi"].includes(book.genre) ? "green" : "";
  return `<article class="book-card"><div class="cover ${coverClass}">${escapeText(book.title).slice(0, 25)}</div><div class="book-info"><h3>${escapeText(book.title)}</h3><p class="book-author">${escapeText(book.author || "Penulis tidak dicatat")}</p><span class="genre">${escapeText(book.genre)}</span><div class="progress-wrap"><div class="progress-label"><span>${latest ? `Hal. ${latest.page}${book.totalPages ? ` dari ${book.totalPages}` : ""}` : "Belum ada sesi"}</span><span>${percent === null ? "—" : `${percent}%`}</span></div>${percent === null ? "" : `<div class="progress"><i style="width:${percent}%"></i></div>`}</div></div><div class="book-actions"><button class="button primary" data-action="log" data-id="${book.id}">Catat</button>${book.status === "reading" ? `<button class="button outline" data-action="finish" data-id="${book.id}">Selesai</button>` : ""}</div></article>`;
}
function renderStats() {
  const logs = data.books.flatMap((book) => book.logs.map((log) => ({ ...log, book })));
  const pages = logs.reduce((sum, log) => sum + Math.max(0, log.page - (log.book.logs.find((previous) => previous.loggedAt < log.loggedAt)?.page || 0)), 0);
  $("#weekly-pages").textContent = `${pages} halaman`; $("#finished-count").textContent = `${data.books.filter((book) => book.status === "finished").length} buku`; $("#session-count").textContent = `${logs.length} sesi`; $("#total-pages").textContent = `${logs.reduce((sum, log) => sum + log.page, 0)} halaman`; $("#streak-count").textContent = `${new Set(logs.map((log) => new Date(log.loggedAt).toDateString())).size} hari`;
  const days = [...Array(7)].map((_, index) => { const date = new Date(); date.setDate(date.getDate() - (6 - index)); return date; });
  $("#week-chart").innerHTML = days.map((day) => { const amount = logs.filter((log) => new Date(log.loggedAt).toDateString() === day.toDateString()).reduce((sum, log) => sum + log.page, 0); return `<div class="bar-item"><div class="bar ${day.toDateString() === new Date().toDateString() ? "today" : ""}" style="height:${Math.max(4, Math.min(100, amount / Math.max(1, pages) * 100))}%"></div><small>${day.toLocaleDateString("id-ID", { weekday: "short" }).slice(0, 2)}</small></div>`; }).join("");
  $("#chart-total").textContent = `${pages} hal.`;
  const counts = genres.map((genre) => ({ genre, count: data.books.filter((book) => book.genre === genre).length })).filter((item) => item.count).sort((a, b) => b.count - a.count); const max = counts[0]?.count || 1;
  $("#genre-chart").innerHTML = counts.length ? counts.map((item) => `<div class="genre-row"><span>${item.genre}</span><div class="genre-line"><i style="width:${item.count / max * 100}%"></i></div><em>${item.count}</em></div>`).join("") : `<p class="muted">Tambahkan buku untuk melihat genre favoritmu.</p>`;
}
function renderGoal() { const goal = data.goal; $("#goal-title").textContent = goal ? `${goal.value} ${goal.type === "books" ? "buku selesai" : "halaman per hari"}` : "Belum ada target"; $("#goal-subtitle").textContent = goal ? "Tetap pelan-pelan, yang penting konsisten." : "Buat target kecil agar langkahmu terasa."; if (goal) { $("#goal-type").value = goal.type; $("#goal-value").value = goal.value; } }
function renderSettings() { const reminder = data.reminder; $("#reminder-enabled").checked = reminder.enabled; $("#reminder-time").value = reminder.time; $("#day-picker").innerHTML = ["M", "S", "S", "R", "K", "J", "S"].map((day, index) => `<button type="button" class="${reminder.days.includes(index) ? "active" : ""}" data-day="${index}">${day}</button>`).join(""); $("#notification-status").textContent = Notification.permission === "denied" ? "Notifikasi ditolak browser. Aktifkan dari pengaturan situs." : reminder.enabled ? `Pengingat aktif pukul ${reminder.time}.` : "Pengingat belum diaktifkan."; }
function route(page) { const valid = ["koleksi", "statistik", "target"].includes(page) ? page : "koleksi"; $$(".page").forEach((item) => item.classList.toggle("hidden", item.dataset.page !== valid)); $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.route === valid)); }
function openLog(id) { activeBookId = id; const book = data.books.find((item) => item.id === id); $("#log-book-name").textContent = `${book.title}${book.totalPages ? ` · ${book.totalPages} halaman` : ""}`; $("#log-page").value = latestPage(book); $("#page-hint").textContent = book.totalPages ? `Masukkan angka 0–${book.totalPages}.` : "Masukkan halaman terakhir yang kamu baca."; openModal("#log-modal"); $("#log-page").focus(); }

async function finishBook(id) {
  try { await api(`/books/${id}`, { method: "PATCH", body: JSON.stringify({ status: "finished" }) }); await refreshData(); showToast("Buku ditandai selesai."); }
  catch (error) { showToast(`Gagal menyimpan: ${error.message}`); }
}
$("#add-book-button").addEventListener("click", () => openModal("#book-modal"));
$$("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModals));
$$(".modal").forEach((modal) => modal.addEventListener("click", (event) => { if (event.target === modal) closeModals(); }));
$$(".filter-tab").forEach((button) => button.addEventListener("click", () => { activeFilter = button.dataset.filter; $$(".filter-tab").forEach((item) => item.classList.toggle("active", item === button)); renderBooks(); }));
$$("[data-route]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); location.hash = link.dataset.route; route(link.dataset.route); }));
window.addEventListener("hashchange", () => route(location.hash.slice(1)));
$("#book-summary").addEventListener("input", (event) => { $("#summary-count").textContent = event.target.value.length; });
$("#book-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter; button.disabled = true;
  try {
    await api("/books", { method: "POST", body: JSON.stringify({ title: $("#book-title").value.trim(), author: $("#book-author").value.trim() || null, genre: $("#book-genre").value, total_pages: Number($("#book-pages").value) || null, summary: $("#book-summary").value.trim() || null, source: "manual" }) });
    event.target.reset(); $("#summary-count").textContent = "0"; closeModals(); activeFilter = "reading"; $$(".filter-tab").forEach((item) => item.classList.toggle("active", item.dataset.filter === "reading")); await refreshData(); showToast("Buku berhasil ditambahkan.");
  } catch (error) { showToast(`Gagal menyimpan buku: ${error.message}`); } finally { button.disabled = false; }
});
$("#log-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const book = data.books.find((item) => item.id === activeBookId); const page = Number($("#log-page").value);
  if (!Number.isInteger(page) || page < 0 || (book.totalPages && page > book.totalPages)) { $("#page-hint").textContent = book.totalPages ? `Halaman harus antara 0 dan ${book.totalPages}.` : "Halaman harus berupa bilangan bulat 0 atau lebih."; return; }
  const button = event.submitter; button.disabled = true;
  try { await api(`/books/${activeBookId}/logs`, { method: "POST", body: JSON.stringify({ page_reached: page, note: $("#log-note").value.trim() || null }) }); event.target.reset(); closeModals(); await refreshData(); showToast("Sesi baca berhasil dicatat."); } catch (error) { showToast(`Gagal menyimpan sesi: ${error.message}`); } finally { button.disabled = false; }
});
$(".quick-add").addEventListener("click", () => { $("#log-page").value = Number($("#log-page").value || 0) + 10; });
$("#goal-form").addEventListener("submit", async (event) => { event.preventDefault(); data.goal = { type: $("#goal-type").value, value: Number($("#goal-value").value) }; try { await persistSettings(); render(); showToast("Target berhasil disimpan."); } catch (error) { showToast(`Gagal menyimpan target: ${error.message}`); } });
$("#reminder-enabled").addEventListener("change", async (event) => { data.reminder.enabled = event.target.checked; try { await persistSettings(); renderSettings(); } catch (error) { showToast(`Gagal menyimpan pengingat: ${error.message}`); } });
$("#reminder-time").addEventListener("change", async (event) => { data.reminder.time = event.target.value; try { await persistSettings(); renderSettings(); } catch (error) { showToast(`Gagal menyimpan pengingat: ${error.message}`); } });
$("#day-picker").addEventListener("click", async (event) => { if (!event.target.dataset.day) return; const day = Number(event.target.dataset.day); data.reminder.days = data.reminder.days.includes(day) ? data.reminder.days.filter((item) => item !== day) : [...data.reminder.days, day]; try { await persistSettings(); renderSettings(); } catch (error) { showToast(`Gagal menyimpan pengingat: ${error.message}`); } });
$("#notification-button").addEventListener("click", async () => { if (!("Notification" in window)) { showToast("Browser ini belum mendukung notifikasi."); return; } const permission = await Notification.requestPermission(); renderSettings(); showToast(permission === "granted" ? "Notifikasi berhasil diizinkan." : "Izin notifikasi belum diberikan."); });
window.addEventListener("online", refreshData); window.addEventListener("offline", () => setOffline(true));

const savedPasscode = localStorage.getItem(PASSCODE_KEY);
if (savedPasscode) { showApp(); refreshData(); }
