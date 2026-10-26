import net from "node:net";

/** One-command Redis RESP2 client for local checkpointing; supports redis://host:port/db. */
export async function redisCommand(url: string, ...args: string[]): Promise<string | null> {
  const target = new URL(url);
  if (target.protocol !== "redis:") throw new Error("Only redis:// URLs are supported");
  if (target.username || target.password || (target.pathname && target.pathname !== "/" && target.pathname !== "/0"))
    throw new Error("Checkpoint client supports unauthenticated Redis database 0 only");
  const host = target.hostname;
  const port = Number(target.port || 6379);
  const packet = `*${args.length}\r\n` + args.map((a) => `\$${Buffer.byteLength(a)}\r\n${a}\r\n`).join("");
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let buf = Buffer.alloc(0);
    const timeout = setTimeout(() => socket.destroy(new Error("Redis timeout")), 2000);
    const done = (err?: Error, value?: string | null) => {
      clearTimeout(timeout); socket.destroy();
      if (err) reject(err); else resolve(value ?? null);
    };
    socket.on("connect", () => socket.write(packet));
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const headEnd = buf.indexOf("\r\n");
      if (headEnd < 0) return;
      const type = String.fromCharCode(buf[0]!);
      const head = buf.subarray(1, headEnd).toString();
      if (type === "-") return done(new Error(head));
      if (type === "+" || type === ":") return done(undefined, head);
      if (type !== "$") return done(new Error("Unexpected Redis reply"));
      const length = Number(head);
      if (length === -1) return done(undefined, null);
      if (buf.length < headEnd + 2 + length + 2) return;
      done(undefined, buf.subarray(headEnd + 2, headEnd + 2 + length).toString());
    });
  });
}
