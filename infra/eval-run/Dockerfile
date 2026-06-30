# Build context is the REPO ROOT (the service bundles ../../lib and ships
# data/exemplars), so build/deploy from there:
#   gcloud run deploy cse-eval-run --source . --dockerfile infra/eval-run/Dockerfile
# or:  docker build -f infra/eval-run/Dockerfile -t cse-eval-run .
FROM node:20-slim
WORKDIR /app

# Install the (externalized) runtime deps for the service.
COPY infra/eval-run/package.json infra/eval-run/
RUN cd infra/eval-run && npm install --no-audit --no-fund

# Source needed to bundle: the service entry + the shared lib it imports as
# ../../lib. Keep the repo's relative layout so those imports resolve.
COPY lib ./lib
COPY infra/eval-run/server.ts infra/eval-run/

# Exemplars are read at runtime from process.cwd()/data/exemplars (cwd is /app).
COPY data/exemplars ./data/exemplars

RUN cd infra/eval-run && npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
# cwd stays /app so loadExemplars finds /app/data/exemplars.
CMD ["node", "infra/eval-run/dist/server.mjs"]
