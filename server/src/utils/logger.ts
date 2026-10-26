type Fields = Record<string, unknown>;
const write = (level: string) => (msg: string, fields: Fields = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));

/** Structured JSON-lines logger (readable via `docker compose logs`, ingestible by Cloud Logging). */
export const log = { info: write("info"), warn: write("warn"), error: write("error") };
export type Logger = typeof log;
