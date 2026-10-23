import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
export async function startDesktopController(control: any) {
  const token = randomBytes(32).toString("hex");
  let origin = "";
  const server = createServer(async (req, res) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    const finish = (code: number, data: any) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (req.headers.host !== new URL(origin).host)
      return finish(403, { error: "Invalid host" });
    const path = req.url?.split("?")[0];
    if (path === "/api") {
      const supplied = req.headers["x-ego-token"];
      if (
        typeof supplied !== "string" ||
        supplied.length !== token.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(token)) ||
        req.headers.origin !== origin
      )
        return finish(403, { error: "Controller authentication required" });
      if (req.method !== "POST") return finish(405, { error: "POST required" });
      try {
        let body = "";
        for await (const chunk of req) {
          body += chunk.toString();
          if (Buffer.byteLength(body) > 16384) {
            req.destroy();
            return;
          }
        }
        const data = JSON.parse(body);
        let result: any;
        switch (data.action) {
          case "status":
            result = {
              profile: control.host.profileId,
              profiles: await control.profiles(),
              tasks: control.host.summaries(),
              sharedLogins: true,
              inbox: (await control.host.inbox?.()) || [],
            };
            break;
          case "assignInbox":
            result = await control.host.assignInbox(data.id, data.targetId);
            break;
          case "pause":
            result = await control.host.pause(data.id);
            break;
          case "pauseAll":
            result = await Promise.all(
              control.host
                .summaries()
                .map((t: any) => control.host.pause(t.id)),
            );
            break;
          case "resume":
            result = await control.host.resume(data.id);
            break;
          case "reveal":
            result = await control.host.reveal(data.id);
            break;
          case "takeControl":
            await control.host.pause(data.id);
            result = await control.host.reveal(data.id);
            break;
          case "close":
            result = await control.host.closeTask(data.id);
            break;
          case "personal":
            result = await control.openPersonal();
            break;
          case "createProfile":
            result = await control.createProfile(data.profile);
            break;
          case "openProfile":
            result = await control.openProfile(data.profile);
            break;
          case "createTask":
            result = await control.host.createUserTask(data.name);
            break;
          case "grant":
            result = await control.host.grantTask(data.id, data.agentId);
            break;
          case "stop":
            result = { stopping: true };
            setTimeout(() => void control.stop(), 50);
            break;
          default:
            return finish(400, { error: "Unknown controller action" });
        }
        return finish(200, result || {});
      } catch (e) {
        return finish(400, { error: (e as Error).message });
      }
    }
    const files: Record<string, [string, string]> = {
      "/": ["index.html", "text/html"],
      "/app.js": ["app.js", "text/javascript"],
      "/style.css": ["style.css", "text/css"],
    };
    if (req.method !== "GET" || !path || !files[path])
      return finish(404, { error: "Not found" });
    try {
      const [name, type] = files[path];
      res.writeHead(200, { "Content-Type": type });
      res.end(await readFile(new URL(`../../assets/${name}`, import.meta.url)));
    } catch {
      finish(500, { error: "Controller assets unavailable" });
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as any;
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: `${origin}/#${token}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
