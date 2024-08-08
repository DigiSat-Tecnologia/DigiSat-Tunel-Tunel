import { serve, type Server, type ServerWebSocket } from "bun";
import type { Client, Payload } from "./types";

const ports = [
  12220, 12221, 12222, 12223, 12224, 12225, 12226, 12227, 12228, 12229, 12230,
  8080,
];

const scheme = "http";
const domain = "localhost";

const clients = new Map<string, ServerWebSocket<Client>>();
const requesters = new Map<string, WritableStreamDefaultWriter>();

const fetch = async (port: number, req: Request, server: Server) => {
  try {
    const reqUrl = new URL(req.url);

    console.log("RECEIVED", req.url)

    if (reqUrl.searchParams.has("new")) {
      const requested = reqUrl.searchParams.get("subdomain");
      let id = requested;

      if (!id) return new Response("id existed", { status: 400 });
      if (clients.has(`${id}.${port}`)) return new Response("id existed", { status: 400 });

      const upgraded = server.upgrade(req, { data: { id } });
      if (upgraded) return;
      else return new Response("upgrade failed", { status: 400 });
    }

    const subdomain = reqUrl.hostname.split(".")[0];

    if (!clients.has(`${subdomain}.${port}`)) {
      return new Response(`${subdomain} not found`, { status: 404 });
    }

    const client = clients.get(`${subdomain}.${port}`)!;
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
    requesters.set(`${method}:${subdomain}${pathname}.${port}`, writable.getWriter());
    client.send(JSON.stringify(payload));

    const res = await readable.getReader().read();
    const { status, statusText, headers, body } = JSON.parse(res.value);

    delete headers["content-encoding"]; // remove problematic header

    const responseBody = headers["content-type"]?.startsWith("image/")
      ? Buffer.from(body, "base64")
      : body;

    return new Response(responseBody, { status, statusText, headers });
  } catch (err) {
    return new Response("fail", { status: 500   ,  });
  }
};

const websocket = (port: number) => ({
  open(ws: ServerWebSocket<Client>) {
    clients.set(`${ws.data.id}.${port}`, ws);
    console.log(`\x1b[32m+ ${ws.data.id} (${clients.size} total) ${port}\x1b[0m`);
    ws.send(
      JSON.stringify({
        url: `${scheme}://${ws.data.id}.${domain}:${port}`,
      })
    );
  },
  message: async (ws: ServerWebSocket<Client>, message: string) => {
    const { method, pathname, ...rest } = JSON.parse(message) as Payload;
    const writer = requesters.get(`${method}:${ws.data.id}${pathname}.${port}`);
    if (!writer) throw "connection not found";

    await writer.write(message);
    await writer.close();
  },
  close(ws: ServerWebSocket<Client>) {
    clients.delete(`${ws.data.id}.${port}`);
    console.log(`\x1b[31m- ${ws.data.id} (${clients.size} total) ${port}\x1b[0m`);
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
