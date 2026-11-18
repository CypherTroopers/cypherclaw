import { defineSolidPage } from "../../app-route-types.tsx";

export const page = defineSolidPage("cypher", () =>
  import("./cypher-page.tsx").then((module) => module.CypherPage),
);
