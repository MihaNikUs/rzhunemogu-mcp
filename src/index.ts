import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { webcrypto, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createServer as createHttpServer } from 'node:http';
import {
  listCategories,
  randomJoke,
  jokeById,
  jokesByCategory,
  searchJokes,
  popularTags,
  siteStats,
} from './query.js';

// Node 18 в ESM не экспонирует глобальный crypto — предоставляем его
if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = webcrypto;
}

// Создаёт экземпляр McpServer со всеми инструментами RzhuNeMogu.
// Каждое соединение получает собственный экземпляр (multi-session).
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'rzhunemogu',
    version: '1.0.0',
  });

  server.registerTool(
    'list_categories',
    {
      title: 'Список категорий',
      description:
        'Возвращает список всех категорий анекдотов на сайте РжуНеМогу (id, название, пометка 18+, количество записей).',
      inputSchema: {},
    },
    async () => {
      const cats = await listCategories();
      return { content: [{ type: 'text', text: JSON.stringify(cats, null, 2) }] };
    }
  );

  server.registerTool(
    'random_joke',
    {
      title: 'Случайный анекдот',
      description:
        'Возвращает случайный анекдот. Можно указать categoryId для получения случайного анекдота из конкретного раздела.',
      inputSchema: { categoryId: z.number().int().optional().describe('ID категории (необязательно)') },
    },
    async ({ categoryId }) => {
      const joke = await randomJoke(categoryId);
      if (!joke) return { content: [{ type: 'text', text: 'Анекдот не найден.' }] };
      return { content: [{ type: 'text', text: JSON.stringify(joke, null, 2) }] };
    }
  );

  server.registerTool(
    'get_joke_by_id',
    {
      title: 'Анекдот по ID',
      description: 'Возвращает анекдот по его числовому ID.',
      inputSchema: { id: z.number().int().positive().describe('Числовой ID анекдота') },
    },
    async ({ id }) => {
      const joke = await jokeById(id);
      if (!joke) return { content: [{ type: 'text', text: 'Анекдот с таким ID не найден.' }] };
      return { content: [{ type: 'text', text: JSON.stringify(joke, null, 2) }] };
    }
  );

  server.registerTool(
    'get_jokes_by_category',
    {
      title: 'Анекдоты по категории',
      description:
        'Возвращает список анекдотов конкретной категории с пагинацией. Используй list_categories для получения корректного category_id.',
      inputSchema: {
        categoryId: z.number().int().positive().describe('ID категории'),
        limit: z.number().int().min(1).max(50).optional().describe('Сколько записей (по умолчанию 15)'),
        offset: z.number().int().min(0).optional().describe('Смещение для пагинации (по умолчанию 0)'),
      },
    },
    async ({ categoryId, limit, offset }) => {
      const { items, total } = await jokesByCategory(categoryId, limit ?? 15, offset ?? 0);
      return { content: [{ type: 'text', text: JSON.stringify({ total, items }, null, 2) }] };
    }
  );

  server.registerTool(
    'search_jokes',
    {
      title: 'Поиск анекдотов',
      description:
        'Полнотекстовый поиск анекдотов по ключевым словам (например, "врач", "Штирлиц", "тёща").',
      inputSchema: {
        query: z.string().min(1).describe('Поисковый запрос'),
        limit: z.number().int().min(1).max(50).optional().describe('Сколько записей (по умолчанию 15)'),
        offset: z.number().int().min(0).optional().describe('Смещение для пагинации'),
      },
    },
    async ({ query, limit, offset }) => {
      const { items, total } = await searchJokes(query, limit ?? 15, offset ?? 0);
      return { content: [{ type: 'text', text: JSON.stringify({ query, total, items }, null, 2) }] };
    }
  );

  server.registerTool(
    'popular_tags',
    {
      title: 'Популярные теги',
      description: 'Возвращает наиболее часто используемые теги анекдотов.',
      inputSchema: { limit: z.number().int().min(1).max(100).optional().describe('Сколько тегов (по умолчанию 30)') },
    },
    async ({ limit }) => {
      const tags = await popularTags(limit ?? 30);
      return { content: [{ type: 'text', text: JSON.stringify(tags, null, 2) }] };
    }
  );

  server.registerTool(
    'site_stats',
    {
      title: 'Статистика сайта',
      description:
        'Общая статистика сайта РжуНеМогу: число анекдотов, категорий, тегов, дата последнего обновления.',
      inputSchema: {},
    },
    async () => {
      const stats = await siteStats();
      return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
    }
  );

  return server;
}

// ---- HTTP-запуск (multi-session streamable HTTP) ----

async function main() {
  const transportMode = process.env.TRANSPORT || 'stdio';
  const port = Number(process.env.PORT || 8081);

  if (transportMode === 'http') {
    // sessionId -> transport
    const transports = new Map<string, StreamableHTTPServerTransport>();

    const httpServer = createHttpServer(async (req, res) => {
      const path = (req.url || '/').split('?')[0];
      const isMcpPath = path === '/' || path === '/mcp';
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId)!.handleRequest(req, res);
        return;
      }

      if (req.method === 'POST' && isMcpPath) {
        // Новое соединение: создаём транспорт + собственный McpServer
        const sid = randomUUID();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sid,
        });
        transport.onclose = () => {
          transports.delete(sid);
        };
        transports.set(sid, transport);
        // Каждое соединение — отдельный McpServer (multi-session)
        const srv = createMcpServer();
        await srv.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

      if (req.method === 'GET' && isMcpPath) {
        if (req.headers['accept']?.includes('text/event-stream')) {
          const sid = randomUUID();
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => sid,
          });
          transport.onclose = () => { transports.delete(sid); };
          transports.set(sid, transport);
          const srv = createMcpServer();
          await srv.connect(transport);
          await transport.handleRequest(req, res);
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ name: 'rzhunemogu-mcp', version: '1.0.0', tools: 7 })
          );
        }
        return;
      }

      res.writeHead(405).end();
    });

    httpServer.listen(port, () => {
      console.error(
        `MCP server (rzhunemogu) listening on http://0.0.0.0:${port} (streamable HTTP, multi-session)`
      );
    });
    process.stdin.resume();
  } else {
    // stdio transport (один инстанс для локальных агентов)
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MCP server (rzhunemogu) running with stdio');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});