const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

const FEEDS = [
  {
    name: '中国新闻网即时',
    region: 'domestic',
    url: 'https://www.chinanews.com.cn/rss/scroll-news.xml'
  },
  {
    name: '中国新闻网时政',
    region: 'domestic',
    url: 'https://www.chinanews.com.cn/rss/china.xml'
  },
  {
    name: '中国新闻网国际',
    region: 'international',
    url: 'https://www.chinanews.com.cn/rss/world.xml'
  },
  {
    name: 'NPR World',
    region: 'international',
    url: 'https://www.npr.org/rss/rss.php?id=1004'
  }
];

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0b1020',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

function decodeXml(text = '') {
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(text = '') {
  return decodeXml(text)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickTag(xml, tags) {
  for (const tag of tags) {
    const escaped = tag.replace(':', '\\:');
    const reg = new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i');
    const match = xml.match(reg);
    if (match?.[1]) {
      return decodeXml(match[1]).trim();
    }
  }
  return '';
}

function parseItems(xml, meta) {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return items.map((itemXml) => {
    const title = stripHtml(pickTag(itemXml, ['title'])) || '未命名新闻';
    const link = stripHtml(pickTag(itemXml, ['link', 'guid']));
    const summary = stripHtml(
      pickTag(itemXml, ['description', 'content:encoded', 'content'])
    ) || '暂无摘要';
    const publishedAt = stripHtml(
      pickTag(itemXml, ['pubDate', 'published', 'updated', 'dc:date'])
    );

    return {
      id: `${meta.name}-${link || title}`,
      title,
      link,
      summary,
      source: meta.name,
      region: meta.region,
      publishedAt,
      timestamp: Number.isNaN(new Date(publishedAt).getTime()) ? 0 : new Date(publishedAt).getTime()
    };
  });
}

async function fetchSingleFeed(meta) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(meta.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'GlobalNewsDesktop/1.0'
      }
    });
    const xml = await response.text();
    return parseItems(xml, meta);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllNews() {
  const settled = await Promise.allSettled(FEEDS.map((feed) => fetchSingleFeed(feed)));
  const articles = [];
  const errors = [];
  const seen = new Set();

  settled.forEach((result, index) => {
    const feed = FEEDS[index];
    if (result.status === 'fulfilled') {
      result.value.forEach((item) => {
        const key = `${item.title}__${item.link}`;
        if (!seen.has(key)) {
          seen.add(key);
          articles.push(item);
        }
      });
    } else {
      errors.push(`${feed.name} 拉取失败`);
    }
  });

  articles.sort((a, b) => b.timestamp - a.timestamp);

  return {
    fetchedAt: new Date().toISOString(),
    articles,
    errors,
    sources: FEEDS.map(({ name, region, url }) => ({ name, region, url }))
  };
}

ipcMain.handle('news:fetch', async () => {
  try {
    return await fetchAllNews();
  } catch (error) {
    return {
      fetchedAt: new Date().toISOString(),
      articles: [],
      errors: [error instanceof Error ? error.message : '拉取失败'],
      sources: FEEDS.map(({ name, region, url }) => ({ name, region, url }))
    };
  }
});

ipcMain.handle('news:openLink', async (_, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
