require("dotenv").config();
const connectDB = require("./config/db");

function requireEnv() {
  const missing = ["MONGO_URI", "JWT_SECRET"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error("Missing env vars:", missing.join(", "));
    process.exit(1);
  }
  if (process.env.JWT_SECRET.length < 32) {
    console.error("JWT_SECRET must be at least 32 characters.");
    process.exit(1);
  }
  if (!process.env.CLIENT_ORIGIN)
    process.env.CLIENT_ORIGIN = "http://localhost:5173";
}

(async () => {
  requireEnv();
  await connectDB();
  // Make sure indexes exist (important in production where autoIndex is off)
  await Promise.all(
    Object.values(require("mongoose").models).map((m) =>
      m
        .syncIndexes()
        .catch((e) => console.error("index sync", m.modelName, e.message)),
    ),
  );
  const app = require("./app");
  const port = process.env.PORT || 5000;
  const server = app.listen(port, () => console.log(`API running on :${port}`));
  const stop = () =>
    server.close(() =>
      require("mongoose")
        .disconnect()
        .then(() => process.exit(0)),
    );
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
