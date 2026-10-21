const path = require("path");
const fs = require("fs");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const sanitize = require("./middleware/sanitize");
const errorHandler = require("./middleware/error");

const app = express();
app.set("trust proxy", 1); // correct client IPs behind nginx / a load balancer (needed for rate limiting)
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        scriptSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }),
);
app.use(compression());
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: "200kb" }));
app.use(cookieParser());
app.use(sanitize);
app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests. Slow down." },
  }),
);

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/me", require("./routes/me"));
app.use("/api/students", require("./routes/students"));
app.use("/api/rooms", require("./routes/rooms"));
app.use("/api/exams", require("./routes/exams"));
app.use("/api/allocations", require("./routes/allocations"));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/admins", require("./routes/admins"));
app.use("/api/settings", require("./routes/settings"));
app.use("/api", (_req, res) => res.status(404).json({ message: "Not found." }));

// Production: serve the built React app from the same origin (simplest + safest for cookies)
const dist = path.join(__dirname, "../../client/dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: "7d", index: false }));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use(errorHandler);
module.exports = app;
