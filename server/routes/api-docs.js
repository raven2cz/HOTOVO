import express from 'express';

const router = express.Router();

const openApiSpec = {
  openapi: "3.0.0",
  info: {
    title: "Todo-List AI Agent API",
    version: "1.0.0",
    description: "API rozhraní pro připojení a řízení úkolů AI agenty v aplikaci Todo-List. Podporuje hierarchické podúkoly, projekty a synchronizaci kalendáře."
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Lokální vývojový server"
    }
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Zadejte svůj API agent token vygenerovaný v Nastavení aplikace."
      }
    },
    schemas: {
      List: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string", example: "Nákup a prodej domu" },
          color: { type: "string", example: "#f59e0b" },
          created_at: { type: "string", format: "date-time" }
        }
      },
      Task: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          list_id: { type: "string", format: "uuid" },
          parent_id: { type: "string", format: "uuid", nullable: true, description: "ID nadřazeného úkolu pro tvorbu subtasků." },
          title: { type: "string", example: "Kontaktovat makléře ohledně prohlídky" },
          description: { type: "string", example: "Připravit si seznam dotazů na rekonstrukci koupelny.", nullable: true },
          status: { type: "string", enum: ["pending", "completed"], default: "pending" },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"], default: "medium" },
          due_date: { type: "string", format: "date-time", nullable: true, description: "Termín splnění úkolu. Pokud je vyplněn a je aktivní Google sync, propíše se do kalendáře." },
          gcal_event_id: { type: "string", nullable: true },
          gcal_updated_at: { type: "string", format: "date-time", nullable: true },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" }
        }
      }
    }
  },
  security: [
    {
      BearerAuth: []
    }
  ],
  paths: {
    "/api/lists": {
      get: {
        summary: "Seznam všech projektů/listů",
        responses: {
          "200": {
            description: "Úspěšný seznam projektů",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/List" }
                }
              }
            }
          }
        }
      },
      post: {
        summary: "Vytvořit nový projekt/list",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  color: { type: "string", description: "HEX kód barvy projektu (např. #ffffff)" }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Projekt byl vytvořen",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/List" }
              }
            }
          }
        }
      }
    },
    "/api/lists/{id}": {
      put: {
        summary: "Aktualizovat projekt/list",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  color: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Projekt byl aktualizován"
          }
        }
      },
      delete: {
        summary: "Smazat projekt/list (včetně všech úkolů)",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Projekt byl smazán"
          }
        }
      }
    },
    "/api/tasks": {
      get: {
        summary: "Seznam úkolů s možností filtrování",
        parameters: [
          { name: "list_id", in: "query", schema: { type: "string" }, description: "Filtrovat podle projektu" },
          { name: "status", in: "query", schema: { type: "string", enum: ["pending", "completed"] }, description: "Filtrovat podle stavu" },
          { name: "priority", in: "query", schema: { type: "string", enum: ["low", "medium", "high", "urgent"] }, description: "Filtrovat podle priority" },
          { name: "due_date", in: "query", schema: { type: "string", format: "date" }, description: "Filtrovat podle dne splnění (formát YYYY-MM-DD)" }
        ],
        responses: {
          "200": {
            description: "Seznam úkolů",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Task" }
                }
              }
            }
          }
        }
      },
      post: {
        summary: "Vytvořit nový úkol nebo podúkol",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title", "list_id"],
                properties: {
                  title: { type: "string" },
                  list_id: { type: "string", format: "uuid" },
                  parent_id: { type: "string", format: "uuid", description: "Vyplňte pokud se jedná o podúkol" },
                  description: { type: "string" },
                  priority: { type: "string", enum: ["low", "medium", "high", "urgent"], default: "medium" },
                  due_date: { type: "string", format: "date-time", description: "Termín ve formátu ISO8601 (např. 2026-05-28T20:00:00.000Z)" }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Úkol byl vytvořen",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Task" }
              }
            }
          }
        }
      }
    },
    "/api/tasks/{id}": {
      put: {
        summary: "Aktualizovat úkol (např. dokončit ho, změnit termín, změnit prioritu)",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  status: { type: "string", enum: ["pending", "completed"] },
                  priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
                  due_date: { type: "string", format: "date-time", nullable: true },
                  list_id: { type: "string" },
                  parent_id: { type: "string", nullable: true }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Úkol byl úspěšně upraven",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Task" }
              }
            }
          }
        }
      },
      delete: {
        summary: "Smazat úkol a všechny jeho podúkoly",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Úkol smazán"
          }
        }
      }
    },
    "/api/tokens/export-data": {
      get: {
        summary: "Exportovat data ze systému",
        parameters: [
          { name: "format", in: "query", schema: { type: "string", enum: ["json", "markdown", "csv"] }, description: "Formát exportu dat" }
        ],
        responses: {
          "200": {
            description: "Exportovaný soubor"
          }
        }
      }
    }
  }
};

// Return OpenAPI Specification for Agents
router.get('/openapi.json', (req, res) => {
  res.json(openApiSpec);
});

// A human-readable API helper page for the agents or developer
router.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Todo API Dokumentace</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #cbd5e1; line-height: 1.6; padding: 2rem; max-width: 800px; margin: 0 auto; }
          h1 { color: #f8fafc; border-bottom: 1px solid #334155; padding-bottom: 0.5rem; }
          h2 { color: #f1f5f9; margin-top: 2rem; }
          code { background-color: #1e293b; color: #f472b6; padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-size: 0.9em; }
          pre { background-color: #1e293b; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; border: 1px solid #334155; }
          .endpoint { background-color: #1e293b; border-left: 4px solid #6366f1; padding: 0.75rem; margin: 1rem 0; border-radius: 0 0.5rem 0.5rem 0; }
          .method { font-weight: bold; color: #38bdf8; margin-right: 0.5rem; }
        </style>
      </head>
      <body>
        <h1>Todo-List API pro AI Agenty 🤖</h1>
        <p>Vítejte! Tato aplikace poskytuje plně vybavené API pro snadnou integraci vašich AI agentů.</p>
        
        <h2>Jak se připojit?</h2>
        <p>Všechny požadavky musí obsahovat hlavičku:</p>
        <pre>Authorization: Bearer [Váš_API_Token]</pre>
        <p>Token si vygenerujte v aplikaci v sekci <strong>Nastavení &rarr; AI Agenti (API)</strong>. Při prvním spuštění serveru se navíc do konzole jednorázově vypíše výchozí token.</p>

        <h2>Základní Endpointy</h2>
        <div class="endpoint"><span class="method">GET</span> <code>/api/tasks</code> - Výpis všech úkolů</div>
        <div class="endpoint"><span class="method">POST</span> <code>/api/tasks</code> - Vytvořit nový úkol / podúkol</div>
        <div class="endpoint"><span class="method">PUT</span> <code>/api/tasks/:id</code> - Upravit úkol (splnit, přejmenovat, změnit datum)</div>
        <div class="endpoint"><span class="method">DELETE</span> <code>/api/tasks/:id</code> - Smazat úkol</div>
        <div class="endpoint"><span class="method">GET</span> <code>/api/lists</code> - Výpis projektů/listů</div>
        <div class="endpoint"><span class="method">GET</span> <code>/api/tokens/export-data?format=markdown</code> - Exportovat do formátu Markdown</div>
        
        <h2>OpenAPI specifikace</h2>
        <p>Strojově čitelnou specifikaci ve formátu OpenAPI 3.0 naleznete na adrese: <a href="/api/docs/openapi.json" style="color:#38bdf8;">/api/docs/openapi.json</a></p>
      </body>
    </html>
  `);
});

export default router;
