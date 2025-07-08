import { serve, type Server, type ServerWebSocket } from "bun";
import crypto from "crypto";
import type { Client, Payload } from "./types";
import type { ReadableStreamReadResult } from "stream/web";

const ports = [12221, 12229, 8080];
const scheme = "http";
const domain = "localhost";

const clients = new Map<string, ServerWebSocket<Client>>();
const requesters = new Map<string, WritableStreamDefaultWriter>();

const fetch = async (port: number, req: Request, server: Server) => {
  try {
    const reqUrl = new URL(req.url);

    if (reqUrl.searchParams.has("new")) {
      const id = reqUrl.searchParams.get("subdomain");

      if (!id) return new Response("id missing", { status: 400 });
      if (clients.has(`${id}.${port}`))
        return new Response("id existed", { status: 400 });

      const upgraded = server.upgrade(req, { data: { id } });
      return upgraded
        ? undefined
        : new Response("upgrade failed", { status: 400 });
    }

    const host = req.headers.get("host") || "";
    const subdomain = host.split(".")[0];
    const key = `${subdomain}.${port}`;

    if (!clients.has(key)) {
      return new Response(`${subdomain} not found`, { status: 404 });
    }

    const client = clients.get(key)!;
    const { method, url, headers: reqHeaders } = req;
    const pathname = new URL(url).pathname;
    const reqBody = await req.text();
    const requestId = crypto.randomUUID();
    const legacyKey = `${method}:${subdomain}${pathname}.${port}`;

    const payload: Payload = {
      requestId,
      method,
      pathname,
      body: reqBody,
      headers: Object.fromEntries(reqHeaders.entries()),
    };

    const { writable, readable } = new TransformStream();
    requesters.set(requestId, writable.getWriter());
    requesters.set(legacyKey, writable.getWriter());

    client.send(JSON.stringify(payload));

    const result = await Promise.race([
      readable.getReader().read(),
      new Promise((_, reject) => setTimeout(() => reject("timeout"), 10000)),
    ]);

    requesters.delete(requestId);
    requesters.delete(legacyKey);

    const { status, statusText, headers, body } = JSON.parse(
      (result as ReadableStreamReadResult<any>).value
    );

    delete headers["content-encoding"];

    const responseBody = headers["content-type"]?.startsWith("image/")
      ? Buffer.from(body, "base64")
      : body;

    return new Response(responseBody, { status, statusText, headers });
  } catch (err) {
    console.error("Proxy error:", err);
    return new Response("fail", { status: 500 });
  }
};

const websocket = (port: number) => ({
  open(ws: ServerWebSocket<Client>) {
    clients.set(`${ws.data.id}.${port}`, ws);
    console.log(
      `\x1b[32m+ ${ws.data.id} (${clients.size} total) ${port}\x1b[0m`
    );
    ws.send(
      JSON.stringify({
        url: `${scheme}://${ws.data.id}.${domain}:${port}`,
      })
    );
  },
  message: async (ws: ServerWebSocket<Client>, message: string) => {
    const parsed = JSON.parse(message);
    const requestId = parsed.requestId;

    if (requestId && requesters.has(requestId)) {
      const writer = requesters.get(requestId)!;
      await writer.write(message);
      await writer.close();
      requesters.delete(requestId);
      return;
    }

    // fallback para clientes antigos que não enviam requestId
    const { method, pathname } = parsed;
    const legacyKey = `${method}:${ws.data.id}${pathname}.${port}`;
    const writer = requesters.get(legacyKey);

    if (!writer) {
      console.error("⚠️ Writer não encontrado para requestId ou legacyKey");
      return;
    }

    await writer.write(message);
    await writer.close();
    requesters.delete(legacyKey);
  },
  close(ws: ServerWebSocket<Client>) {
    clients.delete(`${ws.data.id}.${port}`);
    console.log(
      `\x1b[31m- ${ws.data.id} (${clients.size} total) ${port}\x1b[0m`
    );
  },
});

for (const port of ports) {
  serve<Client>({
    port,
    fetch: (req, server) => fetch(port, req, server),
    websocket: websocket(port),
  });
}

console.log("websocket server up");
