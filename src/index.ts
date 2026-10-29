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
        'Возвращает полный список категорий юмора на РжуНеМогу: id, slug, название, признак «18+», количество опубликованных записей. ' +
        'Только чтение, без побочных эффектов. Ответ — JSON-массив в поле content[0].text. ' +
        'Используй id из этого списка как categoryId в random_joke/get_jokes_by_category.',
      inputSchema: {},
      outputSchema: z.array(
        z.object({
          id: z.number(),
          slug: z.string(),
          title: z.string(),
          is_adult: z.boolean(),
          count: z.number(),
        })
      ),
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
        'Возвращает одну случайную запись (анекдот/историю/афоризм) из базы РжуНеМогу. ' +
        'Если указан categoryId — выбирается случайная запись только из этой категории; иначе из всех опубликованных, включая категории 18+. ' +
        'Только чтение, без побочных эффектов. ' +
        'Повторные вызовы с тем же аргументом могут вернуть разные записи (детерминированности нет). ' +
        'При отсутствии записей в категории возвращается текст «Анекдот не найден».',
      inputSchema: {
        categoryId: z.number().int().optional().describe('ID категории (из list_categories). Если опущен — случайная запись из любой категории, включая 18+.'),
      },
      outputSchema: z.object({
          id: z.number(),
          category_id: z.number(),
          category_title: z.string(),
          content: z.string(),
          is_adult: z.boolean(),
          created_at: z.string(),
        }),
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
      description:
        'Возвращает запись юмора по её числовому ID. ID можно получить из search_jokes или random_joke (поле id). ' +
        'Только чтение, без побочных эффектов. ' +
        'Если записи с таким ID нет или она не опубликована — возвращается текст «Анекдот с таким ID не найден».',
      inputSchema: {
        id: z.number().int().positive().describe('Числовой ID записи (например, 13438). Должен быть целым положительным.'),
      },
      outputSchema: z.object({
          id: z.number(),
          category_id: z.number(),
          category_title: z.string(),
          content: z.string(),
          created_at: z.string(),
        }),
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
        'Возвращает список записей конкретной категории с пагинацией, отсортированных от новых к старым по id (по убыванию). ' +
        'categoryId обязателен (возьми из list_categories). limit — до 50 записей за раз (по умолчанию 15), offset — смещение для пагинации. ' +
        'Только чтение, без побочных эффектов. ' +
        'Ответ содержит total (всего записей в категории) и items (список). Для постраничного просмотра увеличивай offset кратно limit.',
      inputSchema: {
        categoryId: z.number().int().positive().describe('ID категории (из list_categories), например 1 для «Анекдоты». Обязателен.'),
        limit: z.number().int().min(1).max(50).optional().describe('Количество записей за один вызов (1-50). По умолчанию 15.'),
        offset: z.number().int().min(0).optional().describe('Смещение от начала списка для пагинации. По умолчанию 0.'),
      },
      outputSchema: z.object({
          total: z.number(),
          items: z.array(
            z.object({
              id: z.number(),
              category_id: z.number(),
              content: z.string(),
              created_at: z.string(),
            })
          ),
        }),
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
        'Полнотекстовый поиск записей по ключевым словам на русском языке (например, «врач», «Штирлиц», «тёща», «теща»). ' +
        'Использует морфологию русского языка PostgreSQL: word-формы приводятся к основе, поэтому «врач» найдёт и «врачи», «врачом» и т.п. ' +
        'Результаты отсортированы по релевантности (ts_rank). query обязателен; поиск без него вернёт пустой результат. ' +
        'Только чтение, без побочных эффектов. limit до 50 (по умолчанию 15), offset для пагинации.',
      inputSchema: {
        query: z.string().min(1).describe('Поисковый запрос (одно или несколько слов, поддерживается русская морфология). Пример: «про врача».'),
        limit: z.number().int().min(1).max(50).optional().describe('Количество результатов (1-50). По умолчанию 15.'),
        offset: z.number().int().min(0).optional().describe('Смещение для пагинации. По умолчанию 0.'),
      },
      outputSchema: z.object({
          query: z.string(),
          total: z.number(),
          items: z.array(
            z.object({
              id: z.number(),
              category_id: z.number(),
              content: z.string(),
              created_at: z.string(),
            })
          ),
        }),
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
      description:
        'Возвращает наиболее часто используемые теги записей, отсортированные по убыванию частоты (count). ' +
        'Показывает темы, чаще всего встречающиеся в базе РжуНеМогу. Только чтение, без побочных эффектов. ' +
        'limit задаёт сколько тегов вернуть (1-100, по умолчанию 30). Каждый тег — {name, count}, где count — число записей с этим тегом.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe('Сколько тегов вернуть (1-100). По умолчанию 30.'),
      },
      outputSchema: z.array(
        z.object({
          name: z.string(),
          count: z.number(),
        })
      ),
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
        'Возвращает общую статистику базы РжуНеМогу: число опубликованных записей (total_jokes), число категорий (total_categories), ' +
        'число уникальных тегов (total_tags) и дату последнего обновления (last_update). ' +
        'Полезно для получения общего представления о размере и активности базы. Только чтение, без побочных эффектов. ' +
        'Стоимость вызова мала по сравнению с поиском — подходит для быстрых проверок доступности.',
      inputSchema: {},
      outputSchema: z.object({
          total_jokes: z.number(),
          total_categories: z.number(),
          total_tags: z.number(),
          last_update: z.string(),
        }),
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
  // Если задан PORT — почти наверняка нужен streamable HTTP (например, в песочнице Glama),
  // где сервер должен отвечать на HTTP-запросы. Иначе по умолчанию используем stdio.
  const port = Number(process.env.PORT || 0);
  const transportMode = process.env.TRANSPORT || (port ? 'http' : 'stdio');
  const effectivePort = port || 8081;

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

    httpServer.listen(effectivePort, () => {
      console.error(
        `MCP server (rzhunemogu) listening on http://0.0.0.0:${effectivePort} (streamable HTTP, multi-session)`
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