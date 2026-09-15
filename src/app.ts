import "express-async-errors";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./env";
import { attachUser } from "./middleware/auth";
import { getPhotoObject } from "./lib/photo-storage";
import { notFoundHandler, errorHandler } from "./middleware/error-handler";
import { authRouter } from "./routes/auth";
import { formTypesRouter } from "./routes/form-types";
import { assignmentsRouter } from "./routes/assignments";
import { inspectionsRouter } from "./routes/inspections";
import { usersRouter } from "./routes/users";
import { catalogRouter } from "./routes/catalog";
import { dashboardRouter } from "./routes/dashboard";
import { evaluationsRouter } from "./routes/evaluations";
// import { tasksRouter } from "./routes/tasks";
// import { dictionaryRouter } from "./routes/dictionary";
// import { submissionsRouter } from "./routes/submissions";

export const app = express();

app.use(
  cors({
    origin: env.frontendOrigins,
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "25mb" }));
app.use(attachUser);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/form-types", formTypesRouter);
app.use("/api/assignments", assignmentsRouter);
app.use("/api/inspections", inspectionsRouter);
app.use("/api/users", usersRouter);
app.use("/api/catalog", catalogRouter);
app.use("/api/evaluations", evaluationsRouter);
app.use("/api/evaluations", evaluationsRouter);

app.get("/uploads/*", async (req, res) => {
  try {
    const storageKey = req.params[0];

    const object = await getPhotoObject(storageKey);

    if (!object.Body) {
      return res.status(404).json({ error: "not_found" });
    }

    if (object.ContentType) {
      res.setHeader("Content-Type", object.ContentType);
    }

    if (object.ContentLength !== undefined) {
      res.setHeader("Content-Length", String(object.ContentLength));
    }

    object.Body.pipe(res);
  } catch (error) {
    console.error("Erreur lecture photo:", error);
    return res.status(404).json({ error: "not_found" });
  }
});

app.use(notFoundHandler);
app.use(errorHandler);
