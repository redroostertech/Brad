/**
 * Default configuration values
 */

export const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const DEFAULTS = {
  provider: 'openai',
  approval: 'require',
  logLevel: 'normal',
  schedule: {
    audit: '0 6 * * *',      // 6 AM daily
    engage: '0 8,14 * * *',  // 8 AM and 2 PM daily
    content: '0 7 * * 1,3,5', // 7 AM Mon/Wed/Fri
  },
  subreddits: [
    'legaltech',
    'lawfirm',
    'smallbusiness',
    'artificial',
    'startups',
  ],
  maxCrawlPages: 10,
  maxRedditThreads: 5,
  maxContentLength: 5000,
};
