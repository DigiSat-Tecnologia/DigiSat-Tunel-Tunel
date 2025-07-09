export type Client = { id: string };

export type Payload = {
  requestId: string;
  status?: number;
  statusText?: string;
  method?: string;
  pathname?: string;
  extraParams?: string;
  body: string;
  headers: object;
};
