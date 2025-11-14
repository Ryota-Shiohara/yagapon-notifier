# ========================================
# ビルドステージ
# ========================================
FROM node:20-alpine AS builder

WORKDIR /app

# package.json と package-lock.json をコピー
COPY package*.json ./

# 依存関係をインストール（開発用も含む）
RUN npm ci

# ソースコードをコピー
COPY tsconfig.json ./
COPY src ./src

# TypeScriptをビルド
RUN npm run build || npx tsc

# ========================================
# 本番ステージ
# ========================================
FROM node:20-alpine

WORKDIR /app

# package.json と package-lock.json をコピー
COPY package*.json ./

# 本番用の依存関係のみインストール
RUN npm ci --omit=dev

# ビルドステージから成果物をコピー
COPY --from=builder /app/dist ./dist

# 環境変数（デフォルト値、.envやdocker-composeで上書き可能）
ENV NODE_ENV=production
ENV PORT=3000

# ポートを公開
EXPOSE 3000

# アプリケーションを起動
CMD ["node", "dist/index.js"]
