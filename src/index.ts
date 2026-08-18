import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import { env } from "./env";
import { attachUser } from "./middleware/auth";
import { notFoundHandler, errorHandler } from "./middleware/error-handler";
import { authRouter } from "./routes/auth";
import { formTypesRouter } from "./routes/form-types";
import { assignmentsRouter } from "./routes/assignments";
import { inspectionsRouter } from "./routes/inspections";
import { usersRouter } from "./routes/users";
// import { tasksRouter } from "./routes/tasks";
// import { dictionaryRouter } from "./routes/dictionary";
// import { submissionsRouter } from "./routes/submissions";

const app = express();

app.use(
  cors({
    origin: env.frontendOrigins,
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "25mb" }));
app.use(attachUser);

app.use("/uploads", express.static(path.resolve(env.uploadDir)));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/api/form-types", formTypesRouter);
app.use("/api/assignments", assignmentsRouter);
app.use("/api/inspections", inspectionsRouter);
app.use("/api/users", usersRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(
    `LAS Inspections API à l'écoute sur http://localhost:${env.port}`,
  );
});
