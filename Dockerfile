# syntax=docker/dockerfile:1.7

# ---------- Stage 1: build ----------
# fintool is a Vite SPA: `vite build` emits a static dist/. The vite.config.js
# copyExamples plugin copies examples/*.csv into dist/examples/ on closeBundle,
# so the Demo-data button can fetch them at runtime. Default base (/) is correct
# for a container served at root — unlike `npm run publish`, which uses /fintool/.
FROM node:lts-alpine AS builder
WORKDIR /app

# Install deps against the lockfile for reproducible builds.
COPY package.json package-lock.json* ./
RUN npm ci

# Build the static site.
COPY . .
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
