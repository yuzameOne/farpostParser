const puppeteer = require('puppeteer');
const sqlite3 = require('sqlite3').verbose();
const { setTimeout } = require('timers/promises');

// Настройки
const MAX_PAGES = 179; // Максимальное количество страниц для парсинга
const BASE_URL = 'https://www.farpost.ru/vladivostok/service/';
const DELAY_MIN = 2000; // Минимальная задержка между запросами (мс)
const DELAY_MAX = 5000; // Максимальная задержка между запросами (мс)

// Подключение к SQLite и создание новой таблицы с timestamp
const db = new sqlite3.Database('farpost_ads.db');
const tableName = `ads_${Date.now()}`; // Уникальное имя таблицы для каждого запуска

// Создаем таблицу при старте
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      views INTEGER,
      url TEXT,
      page INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Ошибка создания таблицы:', err);
    else console.log(`[+] Создана таблица ${tableName}`);
  });
});

// Генератор случайной задержки
function randomDelay() {
  return Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1)) + DELAY_MIN;
}

// Парсинг одной страницы
async function parsePage(page, browser, pageNum) {
  try {
    console.log(`[→] Парсинг страницы ${pageNum}...`);
    
    const url = pageNum === 1 ? BASE_URL : `${BASE_URL}?page=${pageNum}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Проверка на капчу
    if (await page.evaluate(() => document.querySelector('iframe[src*="captcha"]'))) {
      console.log('[!] Обнаружена капча! Решите ее вручную...');
      await page.waitForNavigation({ timeout: 180000 });
    }

    await page.waitForSelector('.bull-item', { timeout: 10000 });

    // Извлекаем данные
    const ads = await page.evaluate((currentPage) => {
      return Array.from(document.querySelectorAll('.bull-item')).map(item => ({
        title: item.querySelector('.bull-item__self-link')?.textContent.trim() || 'No title',
        views: parseInt(item.querySelector('.views')?.textContent.replace(/\D/g, '') || 0,
        url: item.querySelector('.bull-item__self-link')?.href || '',
        page: currentPage
      }));
    }, pageNum);

    // Сохраняем в SQLite
    const stmt = db.prepare(`INSERT INTO ${tableName} (title, views, url, page) VALUES (?, ?, ?, ?)`);
    ads.forEach(ad => stmt.run(ad.title, ad.views, ad.url, ad.page));
    stmt.finalize();

    console.log(`[✓] Сохранено ${ads.length} объявлений (страница ${pageNum})`);

    // Случайная задержка
    const delay = randomDelay();
    console.log(`[⌛] Пауза ${delay}мс...`);
    await setTimeout(delay);

    return true;
  } catch (error) {
    console.error(`[×] Ошибка на странице ${pageNum}:`, error.message);
    return false;
  }
}

// Главная функция
async function parseFarpost() {
  const browser = await puppeteer.launch({ 
    headless: false, // Для отладки (можно сменить на true)
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
  await page.setViewport({ width: 1366, height: 768 });

  try {
    let currentPage = 1;
    let successCount = 0;
    
    while (currentPage <= MAX_PAGES && successCount < MAX_PAGES) {
      if (await parsePage(page, browser, currentPage)) successCount++;
      currentPage++;
    }

    console.log(`[✓] Готово! Данные в таблице ${tableName}`);
  } catch (error) {
    console.error('[×] Критическая ошибка:', error);
  } finally {
    await browser.close();
    db.close();
  }
}

// Запуск
parseFarpost();
