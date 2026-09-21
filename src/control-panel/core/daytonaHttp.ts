import https from 'https';
import { URL } from 'url';

export async function daytonaHttpRequest(
  urlStr: string,
  options: { method?: string; headers?: Record<string, any>; body?: string }
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request(
      u,
      {
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 7000
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Daytona API request timed out'));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}
