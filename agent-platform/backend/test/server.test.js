import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/server.js";

async function withServer(run) {
  const server = app.listen(0);
  try {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health endpoint reports missing database configuration without crashing", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/healthz");
    assert.equal(response.status, 503);
    assert.equal((await response.json()).status, "not_configured");
  });
});

test("task creation rejects missing owner token", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Build a learning app", type: "app" })
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "unauthorized");
  });
});

test("task creation rejects empty prompt after authentication", async () => {
  const previous = process.env.OWNER_API_TOKEN;
  process.env.OWNER_API_TOKEN = "test-token-that-is-long-enough-for-unit-testing-123456";
  try {
    await withServer(async (base) => {
      const response = await fetch(base + "/api/tasks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + process.env.OWNER_API_TOKEN
        },
        body: JSON.stringify({ prompt: "   ", type: "app" })
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /prompt_must_be/);
    });
  } finally {
    if (previous === undefined) delete process.env.OWNER_API_TOKEN;
    else process.env.OWNER_API_TOKEN = previous;
  }
});

test("malformed JSON is rejected with a safe client error", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid-json"
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_json");
  });
});

test("task lookup rejects malformed identifiers before database access", async () => {
  const previous = process.env.OWNER_API_TOKEN;
  process.env.OWNER_API_TOKEN = "test-token-that-is-long-enough-for-unit-testing-123456";
  try {
    await withServer(async (base) => {
      const response = await fetch(base + "/api/tasks/not-a-uuid", {
        headers: { authorization: "Bearer " + process.env.OWNER_API_TOKEN }
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, "invalid_task_id");
    });
  } finally {
    if (previous === undefined) delete process.env.OWNER_API_TOKEN;
    else process.env.OWNER_API_TOKEN = previous;
  }
});

test("project source generation rejects requests without owner authentication", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/projects/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo", prompt: "Build a small website" })
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "unauthorized");
  });
});

test("project file lookup rejects malformed identifiers after authentication", async () => {
  const previous = process.env.OWNER_API_TOKEN;
  process.env.OWNER_API_TOKEN = "test-token-that-is-long-enough-for-unit-testing-123456";
  try {
    await withServer(async (base) => {
      const response = await fetch(base + "/api/projects/not-a-uuid/files", {
        headers: { authorization: "Bearer " + process.env.OWNER_API_TOKEN }
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, "invalid_project_id");
    });
  } finally {
    if (previous === undefined) delete process.env.OWNER_API_TOKEN;
    else process.env.OWNER_API_TOKEN = previous;
  }
});

test("project ZIP download requires owner authentication", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/projects/00000000-0000-4000-8000-000000000000/download");
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "unauthorized");
  });
});

test("project ZIP download rejects malformed project identifiers", async () => {
  const previous = process.env.OWNER_API_TOKEN;
  process.env.OWNER_API_TOKEN = "test-token-that-is-long-enough-for-unit-testing-123456";
  try {
    await withServer(async (base) => {
      const response = await fetch(base + "/api/projects/not-a-uuid/download", {
        headers: { authorization: "Bearer " + process.env.OWNER_API_TOKEN }
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, "invalid_project_id");
    });
  } finally {
    if (previous === undefined) delete process.env.OWNER_API_TOKEN;
    else process.env.OWNER_API_TOKEN = previous;
  }
});
