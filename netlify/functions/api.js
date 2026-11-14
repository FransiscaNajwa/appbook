const { createClient } = require("@supabase/supabase-js");

const attempts = new Map();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

function config() {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing server configuration: ${missing.join(", ")}`);
  return {
    supabase: createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }),
    origins: (process.env.ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean),
  };
}

function originHeaders(event, allowedOrigins) {
  const origin = event.headers.origin || event.headers.Origin;
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin" };
  if (origin && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS";
  }
  return headers;
}

function response(event, statusCode, body, allowedOrigins) {
  return { statusCode, headers: originHeaders(event, allowedOrigins), body: body === undefined ? "" : JSON.stringify(body) };
}

function clientAddress(event) {
  return event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
}

function checkRateLimit(event) {
  const key = clientAddress(event);
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || now - record.startedAt > WINDOW_MS) {
    attempts.set(key, { startedAt: now, count: 1 });
    return true;
  }
  record.count += 1;
  return record.count <= MAX_ATTEMPTS;
}

function parseBody(event) {
  try { return event.body ? JSON.parse(event.body) : {}; } catch { return null; }
}

function validateBook(input) {
  if (!input || typeof input.title !== "string" || !input.title.trim() || typeof input.genre !== "string" || !input.genre.trim()) return "title and genre are required";
  if (input.total_pages !== undefined && input.total_pages !== null && (!Number.isInteger(input.total_pages) || input.total_pages < 1)) return "total_pages must be a positive integer";
  if (typeof input.summary === "string" && input.summary.length > 500) return "summary must be 500 characters or fewer";
  return null;
}

function validateLog(input) {
  if (!input || !Number.isInteger(input.page_reached) || input.page_reached < 0) return "page_reached must be a non-negative integer";
  if (typeof input.note === "string" && input.note.length > 300) return "note must be 300 characters or fewer";
  return null;
}

exports.handler = async (event) => {
  let settings;
  try { settings = config(); } catch (error) { return response(event, 500, { error: "Server is not configured" }, []); }
  if (event.httpMethod === "OPTIONS") return response(event, 204, undefined, settings.origins);
  if (!checkRateLimit(event)) return response(event, 429, { error: "Too many requests. Try again later." }, settings.origins);
  const path = (event.path || "").replace(/^\/\.netlify\/functions\/api/, "").replace(/^\/api/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  const { supabase } = settings;
  try {
    if (event.httpMethod === "GET" && parts[0] === "books") {
      const { data, error } = await supabase.from("books").select("*, reading_logs(*)").order("updated_at", { ascending: false });
      if (error) throw error;
      return response(event, 200, { books: data }, settings.origins);
    }
    if (event.httpMethod === "GET" && parts[0] === "settings") {
      const { data, error } = await supabase.from("app_settings").select("goal, reminder").eq("id", 1).maybeSingle();
      if (error) throw error;
      return response(event, 200, { settings: data || { goal: null, reminder: { enabled: false, time: "20:00", days: [1, 2, 3, 4, 5] } } }, settings.origins);
    }
    if (event.httpMethod === "PATCH" && parts[0] === "settings") {
      const body = parseBody(event);
      if (!body || (body.goal !== null && typeof body.goal !== "object") || !body.reminder || typeof body.reminder !== "object") return response(event, 400, { error: "goal and reminder are required" }, settings.origins);
      if (body.goal && (!["books", "pages"].includes(body.goal.type) || !Number.isInteger(body.goal.value) || body.goal.value < 1)) return response(event, 400, { error: "invalid goal" }, settings.origins);
      if (typeof body.reminder.enabled !== "boolean" || typeof body.reminder.time !== "string" || !Array.isArray(body.reminder.days)) return response(event, 400, { error: "invalid reminder" }, settings.origins);
      const { data, error } = await supabase.from("app_settings").upsert({ id: 1, goal: body.goal, reminder: body.reminder }).select("goal, reminder").single();
      if (error) throw error;
      return response(event, 200, { settings: data }, settings.origins);
    }
    if (event.httpMethod === "POST" && parts[0] === "books" && parts.length === 1) {
      const body = parseBody(event); const validationError = validateBook(body);
      if (validationError) return response(event, 400, { error: validationError }, settings.origins);
      const { data, error } = await supabase.from("books").insert({ title: body.title.trim(), author: body.author?.trim() || null, genre: body.genre.trim(), total_pages: body.total_pages || null, cover_url: body.cover_url || null, summary: body.summary?.trim() || null, source: body.source || "manual", external_id: body.external_id || null }).select().single();
      if (error) throw error;
      return response(event, 201, { book: data }, settings.origins);
    }
    if (parts[0] === "books" && parts[1] && parts[2] === "logs" && event.httpMethod === "POST") {
      const body = parseBody(event); const validationError = validateLog(body);
      if (validationError) return response(event, 400, { error: validationError }, settings.origins);
      const { data: book, error: bookError } = await supabase.from("books").select("total_pages").eq("id", parts[1]).single();
      if (bookError) throw bookError;
      if (book.total_pages && body.page_reached > book.total_pages) return response(event, 400, { error: "page_reached exceeds total_pages" }, settings.origins);
      const { data, error } = await supabase.from("reading_logs").insert({ book_id: parts[1], page_reached: body.page_reached, note: body.note?.trim() || null, logged_at: body.logged_at || new Date().toISOString() }).select().single();
      if (error) throw error;
      return response(event, 201, { log: data }, settings.origins);
    }
    if (parts[0] === "books" && parts[1] && event.httpMethod === "PATCH") {
      const body = parseBody(event); const update = {};
      if (body.status === "reading" || body.status === "finished") { update.status = body.status; update.finished_at = body.status === "finished" ? new Date().toISOString() : null; } else return response(event, 400, { error: "status must be reading or finished" }, settings.origins);
      const { data, error } = await supabase.from("books").update(update).eq("id", parts[1]).select().single();
      if (error) throw error;
      return response(event, 200, { book: data }, settings.origins);
    }
    return response(event, 404, { error: "Route not found" }, settings.origins);
  } catch (error) {
    console.error("API request failed", { code: error.code, message: error.message });
    return response(event, 500, { error: "Unable to process request" }, settings.origins);
  }
};
