import { serve, type Server, type ServerWebSocket } from "bun";
import type { Client, Payload } from "./types";

const ports = [
  12220, 12221, 12222, 12223, 12224, 12225, 12226, 12227, 12228, 12229, 12230,
];

for (const port of ports) {
  const scheme = Bun.env.SCHEME || "http";
  const domain = Bun.env.DOMAIN || "localhost";

  const clients = new Map<string, ServerWebSocket<Client>>();
  const requesters = new Map<string, WritableStreamDefaultWriter>();

  const fetch = async (req: Request, server: Server) => {
    const reqUrl = new URL(req.url);

    if (reqUrl.searchParams.has("new")) {
      const requested = reqUrl.searchParams.get("subdomain");
      let id = requested;

      if (!id) return new Response("id existed", { status: 500 });
      if (clients.has(id)) return new Response("id existed", { status: 500 });

      const upgraded = server.upgrade(req, { data: { id } });
      if (upgraded) return;
      else return new Response("upgrade failed", { status: 500 });
    }

    const subdomain = reqUrl.hostname.split(".")[0];

    if (!clients.has(subdomain)) {
      return new Response(`${subdomain} not found`, { status: 404 });
    }

    const client = clients.get(subdomain)!;
    const { method, url, headers: reqHeaders } = req;
    const reqBody = await req.text();
    const pathname = new URL(url).pathname;
    const payload: Payload = {
      method,
      pathname,
      body: reqBody,
      headers: Object.fromEntries(reqHeaders.entries()),
    };

    const { writable, readable } = new TransformStream();
    requesters.set(`${method}:${subdomain}${pathname}`, writable.getWriter());
    client.send(JSON.stringify(payload));

    const res = await readable.getReader().read();
    const { status, statusText, headers, body } = JSON.parse(res.value);

    delete headers["content-encoding"]; // remove problematic header

    const responseBody = headers["content-type"]?.startsWith("image/")
      ? Buffer.from(body, "base64")
      : body;

    return new Response(responseBody, { status, statusText, headers });
  };

  const websocket = {
    open(ws: ServerWebSocket<Client>) {
      clients.set(ws.data.id, ws);
      console.log(`\x1b[32m+ ${ws.data.id} (${clients.size} total)\x1b[0m`);
      ws.send(
        JSON.stringify({
          url: `${scheme}://${ws.data.id}.${domain}:${port}`,
        })
      );
    },
    message: async (ws: ServerWebSocket<Client>, message: string) => {
      const { method, pathname, ...rest } = JSON.parse(message) as Payload;
      const writer = requesters.get(`${method}:${ws.data.id}${pathname}`);
      if (!writer) throw "connection not found";

      await writer.write(message);
      await writer.close();
    },
    close(ws: ServerWebSocket<Client>) {
      console.log("closing", ws.data.id);
      clients.delete(ws.data.id);
    },
  };

  serve<Client>({
    port,
    fetch,
    websocket,
  });
}

console.log("websocket server up");
