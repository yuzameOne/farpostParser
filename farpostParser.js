const puppeteer = require('puppeteer');
const sqlite3 = require('sqlite3').verbose();
const { setTimeout } = require('timers/promises');

// Настройки
const MAX_PAGES = 5;
const BASE_URL = 'https://www.farpost.ru/vladivostok/service/';
const DELAY_MIN = 2000;
const DELAY_MAX = 5000;

// Создаем/подключаемся к SQLite базе
const db = new sqlite3.Database('farpost_ads.db');

// Генерируем имя таблицы на основе timestamp
const tableName = `ads_${Date.now()}`;

// Создаем новую таблицу для этого запуска
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS ${tableName} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    views INTEGER,
    url TEXT,
    page INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Ошибка при создании таблицы:', err);
    } else {
      console.log(`Создана новая таблица: ${tableName}`);
    }
  });
});

// ... (остальной код функции randomDelay и parsePage остается без изменений)

async function parseFarpost() {
  const browser = await puppeteer.launch({ 
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
  await page.setViewport({ width: 1366, height: 768 });

  try {
    let currentPage = 1;
    let successCount = 0;
    
    while (currentPage <= MAX_PAGES && successCount < MAX_PAGES) {
      const success = await parsePage(page, browser, currentPage);
      
      if (success) {
        successCount++;
        currentPage++;
      } else {
        currentPage++;
      }
    }

    console.log(`Парсинг завершен. Данные сохранены в таблицу ${tableName}`);
  } catch (error) {
    console.error('Критическая ошибка:', error);
  } finally {
    await browser.close();
    db.close();
  }
}

// Модифицированная функция parsePage для использования новой таблицы
async function parsePage(page, browser, pageNum) {
  try {
    console.log(`Парсинг страницы ${pageNum}...`);
    
    const url = pageNum === 1 ? BASE_URL : `${BASE_URL}?page=${pageNum}`;
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    const isCaptcha = await page.evaluate(() => {
      return document.querySelector('iframe[src*="captcha"]') !== null;
    });

    if (isCaptcha) {
      console.log('Обнаружена капча! Пожалуйста, решите ее вручную.');
      await page.waitForNavigation({ timeout: 180000 });
    }

    await page.waitForSelector('.bull-item', { timeout: 10000 });

    const ads = await page.evaluate((currentPage) => {
      const items = Array.from(document.querySelectorAll('.bull-item'));
      return items.map(item => {
        const titleElement = item.querySelector('.bull-item__self-link');
        const viewsElement = item.querySelector('.views');
        
        return {
          title: titleElement ? titleElement.textContent.trim() : 'No title',
          views: viewsElement ? parseInt(viewsElement.textContent.replace(/\D/g, '')) || 0 : 0,
          url: titleElement ? titleElement.href : '',
          page: currentPage
        };
      });
    }, pageNum);

    // Используем динамическое имя таблицы
    const stmt = db.prepare(`INSERT INTO ${tableName} (title, views, url, page) VALUES (?, ?, ?, ?)`);
    ads.forEach(ad => {
      stmt.run(ad.title, ad.views, ad.url, ad.page);
    });
    stmt.finalize();

    console.log(`Сохранено ${ads.length} объявлений со страницы ${pageNum}`);

    const delay = randomDelay();
    console.log(`Ожидание ${delay}мс перед следующим запросом...`);
    await setTimeout(delay);

    return true;
  } catch (error) {
    console.error(`Ошибка при парсинге страницы ${pageNum}:`, error.message);
    return false;
  }
}

parseFarpost();
