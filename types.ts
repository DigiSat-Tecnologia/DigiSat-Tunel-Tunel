export type Client = { id: string };

export type Payload = {
  status?: number;
  statusText?: string;
  method?: string;
  pathname?: string;
  body: ArrayBuffer;
  headers: object;
};
