// tvOS capture routes name fixture titles ("Test Movie A"); the static parity server holds its own placeholder films.
// Against it, swap the fixture film for the pinned film capture-refs.mjs uses (film-detail, MOVIES[0]); never hard-code a second title.
import { MOVIES } from "../static/catalogue.mjs";

export const FIXTURE_FILM = "Test Movie A";
export const isStatic = (env = process.env) => Boolean(env.PARITY_SERVER_URL) && env.PARITY_LIVE !== "1";
export const staticRoute = (route, env = process.env) => (isStatic(env) ? route.replaceAll(FIXTURE_FILM, MOVIES[0].title) : route);

if (process.argv[1] === new URL(import.meta.url).pathname && process.argv[2] !== undefined) console.log(staticRoute(process.argv[2]));
