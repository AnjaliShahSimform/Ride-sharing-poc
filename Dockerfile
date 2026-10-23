FROM node:20-alpine AS build
# Prisma's engines need OpenSSL; alpine ships without it, so Prisma falls back to
# openssl-1.1.x and the schema engine fails to load.
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
EXPOSE 3000
# Apply pending migrations, then start. Lives here (not in render.yaml's
# dockerCommand) because Render doesn't shell-parse that field the way compose does.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
