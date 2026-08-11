import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import { env } from "./env";
import { attachUser } from "./middleware/auth";
import { notFoundHandler, errorHandler } from "./middleware/error-handler";
import { authRouter } from "./routes/auth";
import { tasksRouter } from "./routes/tasks";
import { dictionaryRouter } from "./routes/dictionary";
import { submissionsRouter } from "./routes/submissions";
import { usersRouter } from "./routes/users";

const app = express();

// credentials:"include" côté frontend (voir auth-api.ts) => origin explicite requis,
// pas de wildcard "*" possible avec credentials.
app.use(
  cors({
    origin: env.frontendOrigins,
    credentials: true,
  }),
);
app.use(cookieParser());
// Les soumissions embarquent des photos en data URL (base64) — limite généreuse
// pour plusieurs constats avec plusieurs photos chacun.
app.use(express.json({ limit: "25mb" }));
app.use(attachUser);

// Photos stockées sur disque pour l'instant (sprint "stockage objets fiable" —
// migration S3/R2 prévue ; l'URL publique ne change pas côté client, seule
// PHOTO_STORAGE_DRIVER et son implémentation changeront).
app.use("/uploads", express.static(path.resolve(env.uploadDir)));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/tasks", tasksRouter);
app.use("/dictionary", dictionaryRouter);
app.use("/submissions", submissionsRouter);
app.use("/users", usersRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`LAS Inspections API à l'écoute sur http://localhost:${env.port}`);
});
