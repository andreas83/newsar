-- Set per-feed extraction methods for feeds that consistently need Puppeteer
-- These feeds either serve JS-rendered content or have complex layouts that
-- Readability can't parse from raw HTML

-- Guardian: JS-rendered article content, Readability often gets truncated
UPDATE feeds SET extraction_method = 'puppeteer' WHERE name = 'The Guardian - World News';

-- BBC: Some articles are JS-rendered, partial extraction rate is significant
UPDATE feeds SET extraction_method = 'puppeteer' WHERE name = 'BBC News - World';

-- BFM TV: French news, JS-heavy, 634 partial extractions
UPDATE feeds SET extraction_method = 'puppeteer' WHERE name = 'BFM TV Economie';

-- Die Welt: German news, 705 partial extractions
UPDATE feeds SET extraction_method = 'puppeteer' WHERE name = 'Die Welt';

-- Der Spiegel: German news, 91 partial extractions
UPDATE feeds SET extraction_method = 'puppeteer' WHERE name = 'Der Spiegel';

-- South China Morning Post: 48 partial, complex layout
UPDATE feeds SET extraction_method = 'puppeteer' WHERE name = 'South China Morning Post';
