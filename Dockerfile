FROM oven/bun

WORKDIR /app

COPY package.json /app/
COPY bun.lockb /app/

RUN bun install --frozen-lockfile --production

COPY . /app

ENV NODE_ENV production
ENTRYPOINT ["bun", "server"]

EXPOSE 12221 12229 8080