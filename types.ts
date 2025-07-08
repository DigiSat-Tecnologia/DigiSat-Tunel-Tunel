export type Client = { id: string };

export type Payload = {
  requestId: string;
  status?: number;
  statusText?: string;
  method?: string;
  pathname?: string;
  body: string;
  headers: object;
};
