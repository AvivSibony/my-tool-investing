FROM node:22-slim
WORKDIR /app
COPY engine ./engine
COPY server ./server
WORKDIR /app/server
RUN npm install --omit=dev && npm install --no-save tsx
ENV NODE_ENV=production PORT=3000
RUN chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx","tsx","src/main.ts"]
