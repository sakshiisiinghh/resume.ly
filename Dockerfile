FROM node:22-alpine AS development-dependencies-env
COPY . /app
WORKDIR /app
RUN npm ci

FROM node:22-alpine AS production-dependencies-env
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci --omit=dev

FROM node:22-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npm run build

# The web server only.
FROM node:22-alpine AS app
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY --from=production-dependencies-env /app/node_modules ./node_modules
COPY --from=build-env /app/build ./build
COPY app/.server ./app/.server
COPY server ./server
RUN mkdir -p /data/storage && chown -R node:node /data/storage /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]

# The background worker only.
FROM node:22-alpine AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY --from=production-dependencies-env /app/node_modules ./node_modules
COPY app ./app
COPY constants ./constants
COPY types ./types
COPY worker ./worker
COPY drizzle ./drizzle
RUN mkdir -p /data/storage && chown -R node:node /data/storage /app
USER node
CMD ["npm", "run", "worker"]

# Web server and worker in one container: the simplest way to run on a single small instance.
# It runs the database migrations first. Last on purpose, so a host that builds the default stage gets this.
FROM node:22-alpine AS combined
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY --from=production-dependencies-env /app/node_modules ./node_modules
COPY --from=build-env /app/build ./build
COPY app ./app
COPY constants ./constants
COPY types ./types
COPY worker ./worker
COPY server ./server
COPY drizzle ./drizzle
COPY scripts/start-combined.ts ./scripts/start-combined.ts
RUN mkdir -p /data/storage && chown -R node:node /data/storage /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npm run db:migrate && exec node --import tsx scripts/start-combined.ts"]
