import { serve, type Server, type ServerWebSocket } from "bun";
import type { Client, Payload } from "./types";

const ports = [12221, 12222];

for (const port of ports) {
  const scheme = Bun.env.SCHEME || "http";
  const domain = Bun.env.DOMAIN || `localhost`;

  const clients = new Map<string, ServerWebSocket<Client>>();
  const requesters = new Map<string, WritableStream>();

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
    const pathname = new URL(url).pathname;
    const reqBody = await req.arrayBuffer(); // Use arrayBuffer() for binary data
    const payload: Payload = {
      method,
      pathname,
      body: reqBody,
      headers: reqHeaders,
    };

    const { writable, readable } = new TransformStream();

    requesters.set(`${method}:${subdomain}${pathname}`, writable);
    client.send(JSON.stringify(payload));

    const reader = readable.getReader();
    const { value, done } = await reader.read();
    if (done) {
      return new Response(null, { status: 204 }); // No content if done
    }

    const { status, statusText, headers, body } = JSON.parse(
      new TextDecoder().decode(value)
    );

    delete headers["content-encoding"]; // Remove problematic header

    return new Response(body, { status, statusText, headers });
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
    message: async (
      { data: { id } }: { data: { id: string } },
      message: any
    ) => {
      console.log("message from", id);

      let parsedMessage: Payload;

      if (message instanceof ArrayBuffer) {
        // Converta ArrayBuffer para string usando TextDecoder
        const decoder = new TextDecoder();
        const messageString = decoder.decode(message);
        parsedMessage = JSON.parse(messageString) as Payload;
      } else {
        // Se for uma string, use-a diretamente
        parsedMessage = JSON.parse(message) as Payload;
      }

      const { method, pathname } = parsedMessage;

      const writable = requesters.get(`${method}:${id}${pathname}`);
      if (!writable) throw new Error("connection not found");

      if (writable.locked) return;

      const writer = writable.getWriter();

      // Se a mensagem for um ArrayBuffer, escreva os dados binários diretamente
      if (message instanceof ArrayBuffer) {
        await writer.write(new Uint8Array(message));
      } else {
        // Caso contrário, escreva a mensagem como texto
        await writer.write(message);
      }

      await writer.close();
    },
    close({ data }: { data: Client }) {
      console.log("closing", data.id);
      clients.delete(data.id);
    },
  };

  serve<Client>({
    port,
    fetch,
    websocket,
  });
}

console.log(`websocket server up`);
