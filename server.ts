import { serve, type Server, type ServerWebSocket } from "bun";
import crypto from "crypto";
import type { Client, Payload } from "./types";

const ports = [12221, 12229, 8080];
const scheme = "http";
const domain = "localhost";

const clients = new Map<string, ServerWebSocket<Client>>();
const requestMap = new Map<
  string,
  { writer: WritableStreamDefaultWriter; meta?: Payload }
>();

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

    if (!clients.has(key))
      return new Response(`${subdomain} not found`, { status: 404 });

    const client = clients.get(key)!;
    const { method, url, headers: reqHeaders } = req;
    const urlToUse = new URL(url);
    const pathname = urlToUse.pathname;
    const extraParams = urlToUse.hash + urlToUse.searchParams.toString();
    const reqBody = await req.text();

    const requestId = crypto.randomUUID();
    const payload: Payload = {
      requestId,
      method,
      pathname,
      extraParams,
      body: reqBody,
      headers: Object.fromEntries(reqHeaders.entries()),
    };

    const { writable, readable } = new TransformStream();
    const writer = writable.getWriter();

    requestMap.set(requestId, { writer });

    client.send(JSON.stringify(payload));

    const bodyChunks: Uint8Array[] = [];

    const reader = readable.getReader();

    const timeout = setTimeout(() => {
      requestMap.delete(requestId);
      writer.close();
    }, 15000);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) bodyChunks.push(value);
    }

    clearTimeout(timeout);

    if (bodyChunks.length === 0) {
      return new Response("No response from client", { status: 504 });
    }

    const fullData = Buffer.concat(bodyChunks);
    const meta = requestMap.get(requestId)?.meta;

    if (!meta) {
      return new Response("No metadata received", { status: 500 });
    }

    const headers = Object.fromEntries(
      Object.entries(meta.headers || {}).filter(
        ([_, v]) => typeof v === "string"
      )
    );

    delete headers["content-encoding"];

    return new Response(new Uint8Array(fullData), {
      status: meta.status || 200,
      statusText: meta.statusText,
      headers,
    });
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
  },

  message: async (ws: ServerWebSocket<Client>, message: string | Buffer) => {
    if (typeof message === "string") {
      const parsed: Payload = JSON.parse(message);
      const { requestId } = parsed;

      if (!requestId) return;

      const context = requestMap.get(requestId);
      if (context) context.meta = parsed;
    } else if (typeof Buffer !== "undefined" && message instanceof Buffer) {
      // mensagem binária
      const requestId = [...requestMap.entries()].find(([_, v]) => v.meta)?.[0];
      const writer = requestId ? requestMap.get(requestId)?.writer : null;
      if (writer) {
        await writer.write(new Uint8Array(message));
        await writer.close();
        requestMap.delete(requestId!);
      }
    }
  },

  close(ws: ServerWebSocket<Client>) {
    clients.delete(`${ws.data.id}.${port}`);
    console.log(
      `\x1b[31m- ${ws.data.id} (${clients.size} total) ${port}\x1b[0m`
    );
  },

  error(ws: ServerWebSocket<Client>, err: Error) {
    console.error(`WebSocket error for ${ws.data.id} on port ${port}:`, err);
    clients.delete(`${ws.data.id}.${port}`);
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
