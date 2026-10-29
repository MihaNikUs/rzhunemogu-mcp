# РжуНеМогу MCP Server

**MCP-сервер, который открывает данные крупнейшего русскоязычного архива юмора [rzhunemogu.ru](https://rzhunemogu.ru) для любых ИИ-агентов.**

> Более 46 000 анекдотов, смешных рассказов, афоризмов, тостов и статусов доступны через стандартный протокол [Model Context Protocol](https://modelcontextprotocol.io).

[![MCP](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io)
[![Node.js](https://img.shields.io/badge/Node.js-18-green)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)](https://www.postgresql.org)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

## ✨ Возможности

MCP-сервер предоставляет ИИ-агентам 7 инструментов для работы с контентом РжуНеМогу:

| Инструмент | Описание |
|---|---|
| `list_categories` | Все категории юмора с количеством записей |
| `random_joke` | Случайный анекдот (по всем разделам или конкретной категории) |
| `get_joke_by_id` | Конкретный анекдот по числовому ID |
| `get_jokes_by_category` | Анекдоты категории с пагинацией |
| `search_jokes` | Полнотекстовый поиск по ключевым словам («врач», «Штирлиц», «тёща») |
| `popular_tags` | Наиболее часто используемые теги |
| `site_stats` | Статистика сайта (число анекдотов, категорий, тегов) |

## 🚀 Быстрый старт

### Подключение как клиент (рекомендуемый способ)

Общедоступный экземпляр сервера уже развёрнут:

```
URL: https://rzhunemogu.ru/mcp
Транспорт: streamable HTTP
```

Добавьте в конфигурацию вашего MCP-клиента:

```json
{
  "mcpServers": {
    "rzhunemogu": {
      "url": "https://rzhunemogu.ru/mcp"
    }
  }
}
```

### Запуск собственного экземпляра

```bash
git clone https://github.com/yourname/rzhunemogu-mcp.git
cd rzhunemogu-mcp
npm install
npm run build

# Настройте подключение к PostgreSQL
export DATABASE_URL="postgres://user:password@localhost:5432/rzhunemogu"

# Запуск в режиме streamable HTTP (порт 8081)
export TRANSPORT=http PORT=8081
npm start

# Или в режиме stdio (для локальных агентов)
export TRANSPORT=stdio
npm start
```

### Требования к базе данных

Сервер работает с PostgreSQL 16. Схема:

- `jokes` — контент (id, category_id, content, created_at, is_published)
- `categories` — категории (id, slug, title, is_adult)
- `tags` — теги (id, name)
- `joke_tags` — связи анекдот-тег

Полнотекстовый поиск использует русский словарь PostgreSQL (`to_tsvector('russian', content)`).

## 🛠 Структура проекта

```
mcp-server/
├── src/
│   ├── index.ts      # Регистрация инструментов + HTTP/stdio запуск
│   ├── query.ts      # SQL-запросы к базе данных
│   └── db.ts         # Пул подключений PostgreSQL
├── package.json
├── tsconfig.json
└── mcp.json          # Метаданные для реестра MCP
```

## 📦 Публикация в реестре MCP

Сервер зарегистрирован в [официальном метареестре MCP](https://registry.modelcontextprotocol.io) через `mcp.json` и доступен в каталогах: Glama, Smithery, mcp.directory, mcp.so.

## 📄 Лицензия

Проект распространяется под лицензией [MIT](LICENSE).

Контент (анекдоты, рассказы, афоризмы) принадлежит rzhunemogu.ru и распространяется с указанием ссылки на источник.

## 🤝 Связь

- Сайт: [rzhunemogu.ru](https://rzhunemogu.ru)
- E-mail: [support@RzhuNeMogu.ru](mailto:support@RzhuNeMogu.ru)
- Разработчик: MihaNikUs