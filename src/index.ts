import { app } from "./app";
import { env } from "./env";

app.listen(env.port, () => {
  console.log(
    `LAS Inspections API à l'écoute sur http://localhost:${env.port}`,
  );
});
