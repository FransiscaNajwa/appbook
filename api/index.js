const { createClient } = require("@supabase/supabase-js");

const attempts = new Map();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

function getConfig() {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error("Missing server configuration");

  return {
    supabase: createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    }),
    origins: (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

function getOriginHeaders(req, allowedOrigins) {
  const origin = req.headers.origin || req.headers.Origin;
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };

  if (origin && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, OPTIONS";
  }

  return headers;
}

function send(res, req, statusCode, body, allowedOrigins) {
  res.setHeader("Content-Type", "application/json");
  res.statusCode = statusCode;
  for (const [key, value] of Object.entries(getOriginHeaders(req, allowedOrigins))) {
    res.setHeader(key, value);
  }
  if (body === undefined) return res.end();
  res.end(JSON.stringify(body));
}

function checkRateLimit(req) {
  const key =
    req.headers["x-vercel-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  const now = Date.now();
  const record = attempts.get(key);

  if (!record || now - record.startedAt > WINDOW_MS) {
    attempts.set(key, { startedAt: now, count: 1 });
    return true;
  }

  record.count += 1;
  return record.count <= MAX_ATTEMPTS;
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return req.body;
}

function validateBook(input) {
  if (!input || typeof input.title !== "string" || !input.title.trim() || typeof input.genre !== "string" || !input.genre.trim()) {
    return "title and genre are required";
  }
  if (input.total_pages !== undefined && input.total_pages !== null && (!Number.isInteger(input.total_pages) || input.total_pages < 1)) {
    return "total_pages must be a positive integer";
  }
  if (typeof input.summary === "string" && input.summary.length > 500) {
    return "summary must be 500 characters or fewer";
  }
  return null;
}

function validateLog(input) {
  if (!input || !Number.isInteger(input.page_reached) || input.page_reached < 0) {
    return "page_reached must be a non-negative integer";
  }
  if (typeof input.note === "string" && input.note.length > 300) {
    return "note must be 300 characters or fewer";
  }
  return null;
}

module.exports = async function handler(req, res) {
  const healthPath = (req.url || "").split("?")[0].replace(/^\/api/, "") || "/";
  if (healthPath === "/health" && req.method === "GET") {
    const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
    const missing = required.filter((key) => !process.env[key]);
    const origins = (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    return send(
      res,
      req,
      missing.length ? 503 : 200,
      { status: missing.length ? "missing_configuration" : "ok", missing },
      origins,
    );
  }

  let settings;
  try {
    settings = getConfig();
  } catch {
    const origins = (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    return send(res, req, 503, { error: "Server is not configured" }, origins);
  }

  if (req.method === "OPTIONS") {
    return send(res, req, 204, undefined, settings.origins);
  }
  if (!checkRateLimit(req)) {
    return send(res, req, 429, { error: "Too many requests. Try again later." }, settings.origins);
  }

  const path = (req.url || "").split("?")[0].replace(/^\/api/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  const { supabase } = settings;

  try {
    if (req.method === "GET" && parts[0] === "health") {
      return send(res, req, 200, { status: "ok", missing: [] }, settings.origins);
    }

    if (req.method === "GET" && parts[0] === "books") {
      const { data, error } = await supabase
        .from("books")
        .select("*, reading_logs(*)")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return send(res, req, 200, { books: data }, settings.origins);
    }

    if (req.method === "GET" && parts[0] === "settings") {
      const { data, error } = await supabase
        .from("app_settings")
        .select("goal, reminder")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return send(
        res,
        req,
        200,
        {
          settings: data || {
            goal: null,
            reminder: { enabled: false, time: "20:00", days: [1, 2, 3, 4, 5] },
          },
        },
        settings.origins,
      );
    }

    if (req.method === "PATCH" && parts[0] === "settings") {
      const body = parseBody(req);
      if (!body || (body.goal !== null && typeof body.goal !== "object") || !body.reminder || typeof body.reminder !== "object") {
        return send(res, req, 400, { error: "goal and reminder are required" }, settings.origins);
      }
      if (body.goal && (!["books", "pages"].includes(body.goal.type) || !Number.isInteger(body.goal.value) || body.goal.value < 1)) {
        return send(res, req, 400, { error: "invalid goal" }, settings.origins);
      }
      if (typeof body.reminder.enabled !== "boolean" || typeof body.reminder.time !== "string" || !Array.isArray(body.reminder.days)) {
        return send(res, req, 400, { error: "invalid reminder" }, settings.origins);
      }
      const { data, error } = await supabase
        .from("app_settings")
        .upsert({ id: 1, goal: body.goal, reminder: body.reminder })
        .select("goal, reminder")
        .single();
      if (error) throw error;
      return send(res, req, 200, { settings: data }, settings.origins);
    }

    if (req.method === "POST" && parts[0] === "books" && parts.length === 1) {
      const body = parseBody(req);
      const validationError = validateBook(body);
      if (validationError) {
        return send(res, req, 400, { error: validationError }, settings.origins);
      }
      const { data, error } = await supabase
        .from("books")
        .insert({
          title: body.title.trim(),
          author: body.author?.trim() || null,
          genre: body.genre.trim(),
          total_pages: body.total_pages || null,
          cover_url: body.cover_url || null,
          summary: body.summary?.trim() || null,
          source: body.source || "manual",
          external_id: body.external_id || null,
        })
        .select()
        .single();
      if (error) throw error;
      return send(res, req, 201, { book: data }, settings.origins);
    }

    if (parts[0] === "books" && parts[1] && parts[2] === "logs" && req.method === "POST") {
      const body = parseBody(req);
      const validationError = validateLog(body);
      if (validationError) {
        return send(res, req, 400, { error: validationError }, settings.origins);
      }
      const { data: book, error: bookError } = await supabase
        .from("books")
        .select("total_pages")
        .eq("id", parts[1])
        .single();
      if (bookError) throw bookError;
      if (book.total_pages && body.page_reached > book.total_pages) {
        return send(res, req, 400, { error: "page_reached exceeds total_pages" }, settings.origins);
      }
      const { data, error } = await supabase
        .from("reading_logs")
        .insert({
          book_id: parts[1],
          page_reached: body.page_reached,
          note: body.note?.trim() || null,
          logged_at: body.logged_at || new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return send(res, req, 201, { log: data }, settings.origins);
    }

    if (parts[0] === "books" && parts[1] && req.method === "PATCH") {
      const body = parseBody(req);
      if (body.status !== "reading" && body.status !== "finished") {
        return send(res, req, 400, { error: "status must be reading or finished" }, settings.origins);
      }
      const update = {
        status: body.status,
        finished_at: body.status === "finished" ? new Date().toISOString() : null,
      };
      const { data, error } = await supabase
        .from("books")
        .update(update)
        .eq("id", parts[1])
        .select()
        .single();
      if (error) throw error;
      return send(res, req, 200, { book: data }, settings.origins);
    }

    return send(res, req, 404, { error: "Route not found" }, settings.origins);
  } catch (error) {
    console.error("API request failed", {
      code: error.code,
      message: error.message,
    });
    return send(res, req, 500, { error: "Unable to process request" }, settings.origins);
  }
};
