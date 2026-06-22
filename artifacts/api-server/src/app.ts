import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import router from "./routes";
import { logger } from "./lib/logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve static frontend
const publicDir = join(__dirname, "..", "public");
app.use(express.static(publicDir));

// SPA fallback
app.get("/{*path}", (_req, res) => {
  res.sendFile(join(publicDir, "index.html"));
});

export default app;
