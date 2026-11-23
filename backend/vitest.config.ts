import { defineConfig } from "vitest/config";

export const MOCK_OPENAI_PORT = 4599;

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://hf:hf@localhost:5432/hireflow_test",
      REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379/2",
      LOCAL_UPLOAD_DIR: "./.test-uploads",
      API_URL: "http://localhost:4000",
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_OPENAI_PORT}/v1`,
      OPENAI_MODEL: "gpt-test",
      SCORING_MAX_ATTEMPTS: "2",
      ADMIN_EMAIL: "root@hireflow.test",
      ADMIN_PASSWORD: "admin-password-1",
    },
  },
});
