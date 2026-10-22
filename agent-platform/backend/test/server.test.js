import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/server.js";

test("health endpoint reports missing database configuration without crashing", async () => {
  const server = app.listen(0);
  try {
    const address = server.address();
    const response = await fetch("http://127.0.0.1:" + address.port + "/healthz");
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.status, "not_configured");
  } finally {
    server.close();
  }
});

test("task creation rejects missing owner token", async () => {
  const server = app.listen(0);
  try {
    const address = server.address();
    const response = await fetch("http://127.0.0.1:" + address.port + "/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Build a learning app", type: "app" })
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "unauthorized");
  } finally {
    server.close();
  }
});

test("task creation rejects empty prompt after authentication", async () => {
  process.env.OWNER_API_TOKEN = "test-token-that-is-long-enough-for-unit-testing-123456";
  const server = app.listen(0);
  try {
    const address = server.address();
    const response = await fetch("http://127.0.0.1:" + address.port + "/api/tasks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + process.env.OWNER_API_TOKEN
      },
      body: JSON.stringify({ prompt: "   ", type: "app" })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /prompt_must_be/);
  } finally {
    server.close();
  }
});
