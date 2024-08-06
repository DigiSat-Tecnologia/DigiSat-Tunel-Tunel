FROM oven/bun:1 as base

WORKDIR /app

COPY package.json /app/
COPY bun.lockb /app/

RUN bun install --frozen-lockfile --production

COPY . /app

ENV NODE_ENV production
ENTRYPOINT ["bun", "server"]

EXPOSE 12220 12221 12222 12223 12224 12225 12226 12227 12228 12229 12230 8080