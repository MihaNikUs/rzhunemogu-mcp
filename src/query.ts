import pool from './db.js';

export interface Joke {
  id: number;
  category_id: number;
  category_title: string;
  content: string;
  created_at: string;
  source_user: string | null;
  is_adult: boolean;
}

// Список категорий (id -> название, взрослая ли)
export async function listCategories(): Promise<{ id: number; slug: string; title: string; is_adult: boolean; count: number }[]> {
  const res = await pool.query(
    `SELECT c.id, c.slug, c.title, c.is_adult, COUNT(j.id)::int AS count
     FROM categories c
     LEFT JOIN jokes j ON j.category_id = c.id AND j.is_published = TRUE
     GROUP BY c.id, c.slug, c.title, c.is_adult
     ORDER BY c.id`
  );
  return res.rows;
}

// Случайный анекдот (без категории — по всем; или по конкретной категории)
export async function randomJoke(categoryId?: number): Promise<Joke | null> {
  let query = `SELECT j.id, j.category_id, c.title AS category_title, j.content, j.created_at, j.source_user, c.is_adult
     FROM jokes j
     JOIN categories c ON c.id = j.category_id
     WHERE j.is_published = TRUE`;
  const params: number[] = [];
  if (categoryId) {
    params.push(categoryId);
    query += ` AND j.category_id = $1`;
  }
  query += ` ORDER BY RANDOM() LIMIT 1`;
  const res = await pool.query(query, params);
  return res.rows[0] ?? null;
}

// Анекдот по id
export async function jokeById(id: number): Promise<Joke | null> {
  const res = await pool.query(
    `SELECT j.id, j.category_id, c.title AS category_title, j.content, j.created_at, j.source_user, c.is_adult
     FROM jokes j
     JOIN categories c ON c.id = j.category_id
     WHERE j.id = $1 AND j.is_published = TRUE`,
    [id]
  );
  return res.rows[0] ?? null;
}

// Анекдоты по категории с пагинацией
export async function jokesByCategory(
  categoryId: number,
  limit = 15,
  offset = 0
): Promise<{ items: Joke[]; total: number }> {
  const totalRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM jokes WHERE category_id = $1 AND is_published = TRUE`,
    [categoryId]
  );
  const total = totalRes.rows[0].total;
  const res = await pool.query(
    `SELECT j.id, j.category_id, c.title AS category_title, j.content, j.created_at, j.source_user, c.is_adult
     FROM jokes j
     JOIN categories c ON c.id = j.category_id
     WHERE j.category_id = $1 AND j.is_published = TRUE
     ORDER BY j.id DESC
     LIMIT $2 OFFSET $3`,
    [categoryId, limit, offset]
  );
  return { items: res.rows, total };
}

// Поиск по тексту через полнотекстовый индекс
export async function searchJokes(
  query: string,
  limit = 15,
  offset = 0
): Promise<{ items: Joke[]; total: number }> {
  const q = query.trim();
  if (!q) return { items: [], total: 0 };
  const totalRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM jokes
     WHERE is_published = TRUE AND search @@ plainto_tsquery('russian', $1)`,
    [q]
  );
  const total = totalRes.rows[0].total;
  const res = await pool.query(
    `SELECT j.id, j.category_id, c.title AS category_title, j.content, j.created_at, j.source_user, c.is_adult,
            ts_rank(j.search, plainto_tsquery('russian', $1)) AS rank
     FROM jokes j
     JOIN categories c ON c.id = j.category_id
     WHERE j.is_published = TRUE AND j.search @@ plainto_tsquery('russian', $1)
     ORDER BY rank DESC
     LIMIT $2 OFFSET $3`,
    [q, limit, offset]
  );
  return { items: res.rows, total };
}

// Общая статистика сайта
export async function siteStats(): Promise<{
  total_jokes: number;
  total_categories: number;
  total_tags: number;
  last_update: string | null;
}> {
  const res = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM jokes WHERE is_published = TRUE) AS total_jokes,
       (SELECT COUNT(*)::int FROM categories) AS total_categories,
       (SELECT COUNT(*)::int FROM tags) AS total_tags,
       (SELECT MAX(created_at)::text FROM jokes) AS last_update`
  );
  return res.rows[0];
}

// Популярные теги
export async function popularTags(limit = 30): Promise<{ name: string; count: number }[]> {
  const res = await pool.query(
    `SELECT t.name, COUNT(jt.joke_id)::int AS count
     FROM tags t
     JOIN joke_tags jt ON jt.tag_id = t.id
     JOIN jokes j ON j.id = jt.joke_id
     WHERE j.is_published = TRUE
     GROUP BY t.name
     ORDER BY count DESC
     LIMIT $1`,
    [limit]
  );
  return res.rows;
}