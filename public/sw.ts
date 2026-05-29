/// <reference lib="webworker" />

// Service Worker for 带货剪手 PWA
// 功能：静态资源缓存、API 响应缓存、离线回退、后台同步

// ============ 类型定义 ============

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<any>): void;
}

interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}

interface SyncEvent extends ExtendableEvent {
  tag: string;
  lastChance: boolean;
}

interface WindowClient {
  url: string;
  focus(): Promise<WindowClient>;
  postMessage(message: any): void;
}

interface Clients {
  claim(): Promise<void>;
  matchAll(options?: { type?: string }): Promise<WindowClient[]>;
  get(id: string): Promise<WindowClient | undefined>;
}

declare const self: ServiceWorkerGlobalScope & {
  registration: ServiceWorkerRegistration & {
    sync: {
      register(tag: string): Promise<void>;
    };
  };
};

// ============ 常量配置 ============

// 缓存版本 - 更新时需要修改版本号
const CACHE_VERSION = 'v1.0.0';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `dynamic-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;
const OFFLINE_CACHE = `offline-${CACHE_VERSION}`;

// 离线页面 URL
const OFFLINE_PAGE = '/offline.html';

// 需要预缓存的静态资源列表
const STATIC_ASSETS: string[] = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// API 路径模式 - 匹配需要 stale-while-revalidate 策略的 API
const API_PATTERNS: RegExp[] = [
  /\/api\/.*$/,
  /\/v\d+\/.*$/,
];

// 静态资源文件扩展名
const STATIC_EXTENSIONS: RegExp = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|webp|avif|mp4|webm)$/i;

// 缓存过期时间（毫秒）
const CACHE_EXPIRATION = {
  api: 5 * 60 * 1000,      // API 缓存 5 分钟
  dynamic: 7 * 24 * 60 * 60 * 1000, // 动态资源 7 天
};

// 最大缓存条目数
const MAX_CACHE_SIZE = {
  api: 100,
  dynamic: 200,
};

// 后台同步标签
const SYNC_TAGS = {
  backgroundSync: 'background-sync',
  queueFailedRequests: 'queue-failed-requests',
};

// ============ 工具函数 ============

/**
 * 生成缓存键，包含时间戳用于过期检查
 */
function createCacheKey(url: string): string {
  return url;
}

/**
 * 检查缓存条目是否过期
 */
function isCacheExpired(response: Response, maxAge: number): boolean {
  const cachedTime = response.headers.get('sw-cached-at');
  if (!cachedTime) return false;
  return Date.now() - parseInt(cachedTime, 10) > maxAge;
}

/**
 * 为响应添加缓存时间戳
 */
function addCacheTimestamp(response: Response): Response {
  const clonedResponse = response.clone();
  const headers = new Headers(clonedResponse.headers);
  headers.set('sw-cached-at', Date.now().toString());
  
  return new Response(clonedResponse.body, {
    status: clonedResponse.status,
    statusText: clonedResponse.statusText,
    headers,
  });
}

/**
 * 限制缓存大小
 */
async function limitCacheSize(cacheName: string, maxSize: number): Promise<void> {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  
  if (keys.length > maxSize) {
    // 删除最旧的缓存条目
    const keysToDelete = keys.slice(0, keys.length - maxSize);
    await Promise.all(keysToDelete.map(key => cache.delete(key)));
  }
}

/**
 * 检查请求是否为 API 请求
 */
function isApiRequest(url: URL): boolean {
  return API_PATTERNS.some(pattern => pattern.test(url.pathname));
}

/**
 * 检查请求是否为静态资源
 */
function isStaticAsset(url: URL): boolean {
  return STATIC_EXTENSIONS.test(url.pathname);
}

/**
 * 检查请求是否为导航请求
 */
function isNavigationRequest(request: Request): boolean {
  return request.mode === 'navigate';
}

/**
 * 获取离线回退响应
 */
async function getOfflineResponse(request: Request): Promise<Response> {
  // 对于导航请求，返回离线页面
  if (isNavigationRequest(request)) {
    const cache = await caches.open(OFFLINE_CACHE);
    const offlineResponse = await cache.match(OFFLINE_PAGE);
    if (offlineResponse) {
      return offlineResponse;
    }
    // 如果离线页面也没有缓存，返回基本的离线响应
    return new Response(
      `<!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>带货剪手 - 离线</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: #0a0a0f;
            color: #ffffff;
          }
          .container {
            text-align: center;
            padding: 2rem;
          }
          .icon {
            font-size: 4rem;
            margin-bottom: 1rem;
          }
          h1 {
            font-size: 1.5rem;
            margin-bottom: 0.5rem;
            color: #7c5cfc;
          }
          p {
            color: #a0a0a0;
            margin-bottom: 1.5rem;
          }
          button {
            background: #7c5cfc;
            color: white;
            border: none;
            padding: 0.75rem 2rem;
            border-radius: 0.5rem;
            font-size: 1rem;
            cursor: pointer;
          }
          button:hover {
            background: #6b4ce0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">📡</div>
          <h1>暂时无法连接</h1>
          <p>请检查您的网络连接后重试</p>
          <button onclick="window.location.reload()">重新加载</button>
        </div>
      </body>
      </html>`,
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers({ 'Content-Type': 'text/html; charset=utf-8' }),
      }
    );
  }
  
  // 对于图片请求，返回占位图
  if (request.destination === 'image') {
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect fill="#1a1a2e" width="200" height="200"/><text fill="#4a4a6a" font-family="sans-serif" font-size="14" text-anchor="middle" x="100" y="100">图片离线</text></svg>',
      { headers: { 'Content-Type': 'image/svg+xml' } }
    );
  }
  
  // 其他请求返回网络错误
  return new Response('Network error', {
    status: 408,
    statusText: 'Request Timeout',
  });
}

/**
 * 发送消息给所有客户端
 */
async function broadcastMessage(message: any): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((client: WindowClient) => {
    client.postMessage(message);
  });
}

// ============ 缓存策略 ============

/**
 * Cache-First 策略 - 适用于静态资源
 */
async function cacheFirstStrategy(request: Request): Promise<Response> {
  const cache = await caches.open(STATIC_CACHE);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    // 后台更新缓存（不阻塞当前请求）
    fetch(request)
      .then(async (response) => {
        if (response.ok) {
          await cache.put(request, response.clone());
        }
      })
      .catch(() => {/* 忽略更新错误 */});
    return cachedResponse;
  }
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return getOfflineResponse(request);
  }
}

/**
 * Stale-While-Revalidate 策略 - 适用于 API 请求
 */
async function staleWhileRevalidateStrategy(request: Request): Promise<Response> {
  const cache = await caches.open(API_CACHE);
  const cachedResponse = await cache.match(request);
  
  // 后台更新函数
  const fetchAndCache = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const responseWithTimestamp = addCacheTimestamp(response);
        await cache.put(request, responseWithTimestamp.clone());
        
        // 限制缓存大小
        await limitCacheSize(API_CACHE, MAX_CACHE_SIZE.api);
        
        // 通知客户端有新数据
        broadcastMessage({
          type: 'API_CACHE_UPDATED',
          url: request.url,
          timestamp: Date.now(),
        });
        
        return responseWithTimestamp;
      }
      return response;
    })
    .catch((error) => {
      console.error('SW: API fetch failed:', error);
      throw error;
    });
  
  if (cachedResponse) {
    // 检查是否过期
    if (!isCacheExpired(cachedResponse, CACHE_EXPIRATION.api)) {
      // 未过期，返回缓存但仍后台更新
      fetchAndCache.catch(() => {});
      return cachedResponse;
    }
    // 已过期，等待网络响应
    try {
      return await fetchAndCache;
    } catch (error) {
      // 网络失败，返回过期的缓存
      return cachedResponse;
    }
  }
  
  // 没有缓存，直接请求网络
  try {
    return await fetchAndCache;
  } catch (error) {
    // 网络失败且无缓存，返回离线响应
    return getOfflineResponse(request);
  }
}

/**
 * Network-First 策略 - 适用于导航请求
 */
async function networkFirstStrategy(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      await cache.put(request, response.clone());
      await limitCacheSize(DYNAMIC_CACHE, MAX_CACHE_SIZE.dynamic);
    }
    return response;
  } catch (error) {
    const cache = await caches.open(DYNAMIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    return getOfflineResponse(request);
  }
}

// ============ 事件监听器 ============

/**
 * Install 事件 - 预缓存静态资源
 */
self.addEventListener('install', (event: ExtendableEvent) => {
  console.log('SW: Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(async (cache) => {
        console.log('SW: Pre-caching static assets');
        
        // 创建离线页面并缓存
        const offlineResponse = new Response(
          `<!DOCTYPE html>
          <html lang="zh-CN">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>带货剪手 - 离线</title>
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%);
                color: #ffffff;
              }
              .container {
                text-align: center;
                padding: 2rem;
                max-width: 400px;
              }
              .icon {
                font-size: 5rem;
                margin-bottom: 1.5rem;
                animation: pulse 2s infinite;
              }
              @keyframes pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.1); }
              }
              h1 {
                font-size: 1.75rem;
                margin-bottom: 0.75rem;
                background: linear-gradient(90deg, #7c5cfc, #a78bfa);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
              }
              p {
                color: #a0a0a0;
                margin-bottom: 2rem;
                line-height: 1.6;
              }
              .button-group {
                display: flex;
                flex-direction: column;
                gap: 1rem;
              }
              button {
                background: linear-gradient(90deg, #7c5cfc, #6b4ce0);
                color: white;
                border: none;
                padding: 0.875rem 2rem;
                border-radius: 0.75rem;
                font-size: 1rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
              }
              button:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 20px rgba(124, 92, 252, 0.4);
              }
              button.secondary {
                background: transparent;
                border: 2px solid #7c5cfc;
              }
              button.secondary:hover {
                background: rgba(124, 92, 252, 0.1);
              }
              .features {
                margin-top: 3rem;
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 1rem;
              }
              .feature {
                padding: 1rem;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 0.75rem;
              }
              .feature-icon {
                font-size: 1.5rem;
                margin-bottom: 0.5rem;
              }
              .feature-text {
                font-size: 0.75rem;
                color: #a0a0a0;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="icon">✂️</div>
              <h1>带货剪手</h1>
              <p>您当前处于离线状态<br>部分功能暂时不可用</p>
              <div class="button-group">
                <button onclick="window.location.reload()">🔄 重新连接</button>
                <button class="secondary" onclick="history.back()">← 返回上一页</button>
              </div>
              <div class="features">
                <div class="feature">
                  <div class="feature-icon">📦</div>
                  <div class="feature-text">离线缓存</div>
                </div>
                <div class="feature">
                  <div class="feature-icon">🔄</div>
                  <div class="feature-text">自动同步</div>
                </div>
                <div class="feature">
                  <div class="feature-icon">⚡</div>
                  <div class="feature-text">快速恢复</div>
                </div>
              </div>
            </div>
            <script>
              // 监听在线状态变化
              window.addEventListener('online', () => {
                window.location.reload();
              });
              
              // 定期检查网络状态
              setInterval(() => {
                if (navigator.onLine) {
                  window.location.reload();
                }
              }, 5000);
            </script>
          </body>
          </html>`,
          {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }
        );
        
        await cache.put(OFFLINE_PAGE, offlineResponse);
        
        // 预缓存其他静态资源
        return cache.addAll(STATIC_ASSETS.filter(asset => asset !== OFFLINE_PAGE));
      })
      .then(() => {
        console.log('SW: Pre-caching complete');
        // 立即激活，不等待
        return self.skipWaiting();
      })
  );
});

/**
 * Activate 事件 - 清理旧缓存
 */
self.addEventListener('activate', (event: ExtendableEvent) => {
  console.log('SW: Activating...');
  
  const currentCaches = [STATIC_CACHE, DYNAMIC_CACHE, API_CACHE, OFFLINE_CACHE];
  
  event.waitUntil(
    caches.keys()
      .then(async (cacheNames) => {
        // 删除不在当前版本的缓存
        const cachesToDelete = cacheNames.filter(
          name => !currentCaches.includes(name)
        );
        
        console.log('SW: Deleting old caches:', cachesToDelete);
        await Promise.all(cachesToDelete.map(name => caches.delete(name)));
        
        // 立即接管所有客户端
        await self.clients.claim();
        
        console.log('SW: Activation complete');
      })
  );
});

/**
 * Fetch 事件 - 拦截网络请求
 */
self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  
  // 忽略非 GET 请求
  if (event.request.method !== 'GET') {
    return;
  }
  
  // 忽略 chrome-extension:// 等非 http(s) 请求
  if (!url.protocol.startsWith('http')) {
    return;
  }
  
  // 根据请求类型选择策略
  if (isStaticAsset(url)) {
    // 静态资源：Cache-First 策略
    event.respondWith(cacheFirstStrategy(event.request));
  } else if (isApiRequest(url)) {
    // API 请求：Stale-While-Revalidate 策略
    event.respondWith(staleWhileRevalidateStrategy(event.request));
  } else if (isNavigationRequest(event.request)) {
    // 导航请求：Network-First 策略
    event.respondWith(networkFirstStrategy(event.request));
  } else {
    // 其他请求：Network-First 策略
    event.respondWith(networkFirstStrategy(event.request));
  }
});

/**
 * Sync 事件 - 后台同步
 */
self.addEventListener('sync', (event: any) => {
  console.log('SW: Background sync triggered:', event.tag);
  
  if (event.tag === SYNC_TAGS.backgroundSync) {
    event.waitUntil(doBackgroundSync());
  }
  
  if (event.tag === SYNC_TAGS.queueFailedRequests) {
    event.waitUntil(processFailedRequestsQueue());
  }
});

/**
 * Message 事件 - 处理来自客户端的消息
 */
self.addEventListener('message', (event: ExtendableEvent & { data: any }) => {
  console.log('SW: Message received:', event.data);
  
  switch (event.data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CACHE_URLS':
      // 手动缓存指定 URL
      event.waitUntil(
        caches.open(DYNAMIC_CACHE)
          .then(cache => cache.addAll(event.data.urls))
      );
      break;
      
    case 'CLEAR_CACHE':
      // 清除指定缓存
      event.waitUntil(
        caches.delete(event.data.cacheName || DYNAMIC_CACHE)
      );
      break;
      
    case 'GET_CACHE_SIZE':
      // 获取缓存大小信息
      event.waitUntil(
        getCacheSize()
          .then(size => {
            if (event.source) {
              (event.source as WindowClient).postMessage({
                type: 'CACHE_SIZE',
                data: size,
              });
            }
          })
      );
      break;
      
    case 'QUEUE_FAILED_REQUEST':
      // 将失败的请求加入队列
      event.waitUntil(
        addToFailedRequestsQueue(event.data.request)
      );
      break;
  }
});

// ============ 后台同步功能 ============

/**
 * 执行后台同步
 */
async function doBackgroundSync(): Promise<void> {
  try {
    console.log('SW: Performing background sync...');
    
    // 通知客户端同步开始
    await broadcastMessage({
      type: 'SYNC_START',
      timestamp: Date.now(),
    });
    
    // 处理失败的请求队列
    await processFailedRequestsQueue();
    
    // 预缓存重要页面
    await precacheImportantPages();
    
    // 通知客户端同步完成
    await broadcastMessage({
      type: 'SYNC_COMPLETE',
      timestamp: Date.now(),
    });
    
    console.log('SW: Background sync complete');
  } catch (error) {
    console.error('SW: Background sync failed:', error);
    
    await broadcastMessage({
      type: 'SYNC_ERROR',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now(),
    });
  }
}

/**
 * 处理失败的请求队列
 */
async function processFailedRequestsQueue(): Promise<void> {
  const cache = await caches.open('failed-requests');
  const requests = await cache.keys();
  
  console.log(`SW: Processing ${requests.length} failed requests`);
  
  const results = await Promise.allSettled(
    requests.map(async (request) => {
      try {
        const response = await cache.match(request);
        if (response) {
          const body = await response.json();
          // 重试请求
          const retryResponse = await fetch(request.url, {
            method: body.method || 'POST',
            headers: body.headers || { 'Content-Type': 'application/json' },
            body: body.body ? JSON.stringify(body.body) : undefined,
          });
          
          if (retryResponse.ok) {
            await cache.delete(request);
            return { success: true, url: request.url };
          }
        }
        return { success: false, url: request.url };
      } catch (error) {
        return { success: false, url: request.url, error };
      }
    })
  );
  
  const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  console.log(`SW: ${successful}/${requests.length} failed requests processed`);
  
  // 通知客户端
  await broadcastMessage({
    type: 'FAILED_REQUESTS_PROCESSED',
    total: requests.length,
    successful,
    timestamp: Date.now(),
  });
}

/**
 * 将失败的请求加入队列
 */
async function addToFailedRequestsQueue(requestData: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: any;
}): Promise<void> {
  const cache = await caches.open('failed-requests');
  const response = new Response(JSON.stringify(requestData), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  await cache.put(
    new Request(requestData.url, { method: requestData.method }),
    response
  );
  
  // 注册后台同步
  try {
    await self.registration.sync.register(SYNC_TAGS.queueFailedRequests);
  } catch (error) {
    console.error('SW: Failed to register sync:', error);
  }
}

/**
 * 预缓存重要页面
 */
async function precacheImportantPages(): Promise<void> {
  const importantPages = [
    '/',
    '/dashboard',
    '/projects',
  ];
  
  const cache = await caches.open(DYNAMIC_CACHE);
  
  await Promise.allSettled(
    importantPages.map(async (page) => {
      try {
        const response = await fetch(page);
        if (response.ok) {
          await cache.put(page, response);
        }
      } catch (error) {
        console.error(`SW: Failed to precache ${page}:`, error);
      }
    })
  );
}

/**
 * 获取缓存大小信息
 */
async function getCacheSize(): Promise<Record<string, number>> {
  const cacheNames = await caches.keys();
  const sizes: Record<string, number> = {};
  
  await Promise.all(
    cacheNames.map(async (name) => {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      sizes[name] = keys.length;
    })
  );
  
  return sizes;
}

// ============ 定期维护 ============

/**
 * 定期清理过期缓存
 */
async function cleanupExpiredCache(): Promise<void> {
  console.log('SW: Cleaning up expired cache...');
  
  // 清理 API 缓存中的过期条目
  const apiCache = await caches.open(API_CACHE);
  const apiKeys = await apiCache.keys();
  
  await Promise.all(
    apiKeys.map(async (request) => {
      const response = await apiCache.match(request);
      if (response && isCacheExpired(response, CACHE_EXPIRATION.api)) {
        await apiCache.delete(request);
      }
    })
  );
  
  // 限制缓存大小
  await limitCacheSize(DYNAMIC_CACHE, MAX_CACHE_SIZE.dynamic);
  await limitCacheSize(API_CACHE, MAX_CACHE_SIZE.api);
  
  console.log('SW: Cache cleanup complete');
}

// 每小时执行一次缓存清理
setInterval(cleanupExpiredCache, 60 * 60 * 1000);

// ============ 导出（用于 TypeScript） ============

export {}; 