'use client';

/**
 * Service Worker 使用示例组件
 * 
 * 这个文件展示了如何在应用中使用 Service Worker 功能
 */

import { useEffect, useState } from 'react';
import { useServiceWorker, useServiceWorkerStatus } from '@/hooks/use-service-worker';
import { ServiceWorkerStatus, OnlineStatusIndicator } from '@/components/service-worker-status';

// ============ 示例 1: 基本状态显示 ============

export function BasicStatusExample() {
  const { isOnline, hasUpdate, isSyncing } = useServiceWorkerStatus();
  
  return (
    <div className="p-4 bg-gray-900 rounded-lg">
      <h3 className="text-lg font-semibold mb-4">网络状态</h3>
      <div className="space-y-2">
        <p className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
          {isOnline ? '在线' : '离线'}
        </p>
        {hasUpdate && (
          <p className="text-blue-400">有新版本可用！</p>
        )}
        {isSyncing && (
          <p className="text-yellow-400">正在同步...</p>
        )}
      </div>
    </div>
  );
}

// ============ 示例 2: 完整功能演示 ============

export function FullFeaturedExample() {
  const {
    state,
    hasUpdate,
    isSyncing,
    lastSyncTime,
    checkForUpdate,
    applyUpdate,
    clearCache,
    getCacheSize,
    cacheUrls,
    registerBackgroundSync,
  } = useServiceWorker({
    autoRegister: true,
    onUpdateAvailable: () => {
      console.log('有新版本可用！');
    },
    onOnline: () => {
      console.log('网络已恢复');
    },
    onOffline: () => {
      console.log('网络已断开');
    },
    onSyncComplete: () => {
      console.log('同步完成');
    },
  });

  const [cacheSize, setCacheSize] = useState<Record<string, number> | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 获取缓存大小
  const handleGetCacheSize = async () => {
    setIsLoading(true);
    try {
      const size = await getCacheSize();
      setCacheSize(size);
    } finally {
      setIsLoading(false);
    }
  };

  // 清除缓存
  const handleClearCache = async () => {
    if (confirm('确定要清除所有缓存吗？')) {
      await clearCache();
      setCacheSize(null);
    }
  };

  // 缓存指定页面
  const handleCachePages = async () => {
    await cacheUrls([
      '/',
      '/dashboard',
      '/projects',
      '/settings',
    ]);
    alert('页面已缓存！');
  };

  // 注册后台同步
  const handleRegisterSync = async () => {
    const success = await registerBackgroundSync('my-background-sync');
    alert(success ? '后台同步已注册' : '注册失败');
  };

  return (
    <div className="p-6 bg-gray-900 rounded-lg">
      <h3 className="text-xl font-semibold mb-6">Service Worker 完整功能演示</h3>
      
      {/* 状态信息 */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-gray-800 rounded-lg">
          <p className="text-sm text-gray-400">支持状态</p>
          <p className="text-lg font-medium">
            {state.isSupported ? '✅ 支持' : '❌ 不支持'}
          </p>
        </div>
        
        <div className="p-4 bg-gray-800 rounded-lg">
          <p className="text-sm text-gray-400">注册状态</p>
          <p className="text-lg font-medium">
            {state.isRegistered ? '✅ 已注册' : '⏳ 未注册'}
          </p>
        </div>
        
        <div className="p-4 bg-gray-800 rounded-lg">
          <p className="text-sm text-gray-400">网络状态</p>
          <p className="text-lg font-medium">
            {state.isOnline ? '🟢 在线' : '🔴 离线'}
          </p>
        </div>
        
        <div className="p-4 bg-gray-800 rounded-lg">
          <p className="text-sm text-gray-400">同步状态</p>
          <p className="text-lg font-medium">
            {isSyncing ? '🔄 同步中' : '✅ 空闲'}
          </p>
        </div>
      </div>
      
      {/* 更新信息 */}
      {hasUpdate && (
        <div className="p-4 bg-blue-900/50 border border-blue-700 rounded-lg mb-6">
          <p className="text-blue-300 mb-3">有新版本可用！</p>
          <button
            onClick={() => {
              applyUpdate();
              window.location.reload();
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
          >
            立即更新
          </button>
        </div>
      )}
      
      {/* 最后同步时间 */}
      {lastSyncTime && (
        <div className="p-4 bg-gray-800 rounded-lg mb-6">
          <p className="text-sm text-gray-400">上次同步时间</p>
          <p className="text-lg">{lastSyncTime.toLocaleString()}</p>
        </div>
      )}
      
      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button
          onClick={checkForUpdate}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
        >
          检查更新
        </button>
        
        <button
          onClick={handleGetCacheSize}
          disabled={isLoading}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors disabled:opacity-50"
        >
          {isLoading ? '加载中...' : '获取缓存大小'}
        </button>
        
        <button
          onClick={handleClearCache}
          className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-md transition-colors"
        >
          清除缓存
        </button>
        
        <button
          onClick={handleCachePages}
          className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded-md transition-colors"
        >
          缓存重要页面
        </button>
        
        <button
          onClick={handleRegisterSync}
          className="px-4 py-2 bg-purple-700 hover:bg-purple-600 rounded-md transition-colors"
        >
          注册后台同步
        </button>
      </div>
      
      {/* 缓存大小显示 */}
      {cacheSize && (
        <div className="p-4 bg-gray-800 rounded-lg">
          <h4 className="font-medium mb-3">缓存统计</h4>
          <div className="space-y-2">
            {Object.entries(cacheSize).map(([name, count]) => (
              <div key={name} className="flex justify-between">
                <span className="text-gray-400">{name}</span>
                <span>{count} 个条目</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ 示例 3: 带状态通知的布局 ============

export function LayoutWithSWStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {/* 主内容 */}
      {children}
      
      {/* Service Worker 状态通知 */}
      <ServiceWorkerStatus
        showOnlineStatus={true}
        showUpdateNotification={true}
        position="bottom-right"
      />
    </div>
  );
}

// ============ 示例 4: 带状态指示器的导航栏 ============

export function NavbarWithStatus() {
  return (
    <nav className="flex items-center justify-between p-4 bg-gray-900">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold">萌萌的</h1>
      </div>
      
      <div className="flex items-center gap-4">
        <OnlineStatusIndicator />
        {/* 其他导航项 */}
      </div>
    </nav>
  );
}

// ============ 示例 5: 离线友好的数据获取 ============

export function OfflineFriendlyDataFetcher() {
  const { state, queueFailedRequest } = useServiceWorker();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const fetchData = async () => {
    setIsPending(true);
    setError(null);
    
    try {
      const response = await fetch('/api/data');
      if (!response.ok) {
        throw new Error('请求失败');
      }
      const result = await response.json();
      setData(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '未知错误';
      setError(errorMessage);
      
      // 如果离线，将请求加入队列
      if (!state.isOnline) {
        await queueFailedRequest({
          url: '/api/data',
          method: 'GET',
        });
        console.log('请求已加入离线队列，将在网络恢复后重试');
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="p-4 bg-gray-900 rounded-lg">
      <h3 className="text-lg font-semibold mb-4">离线友好的数据获取</h3>
      
      <button
        onClick={fetchData}
        disabled={isPending}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 mb-4"
      >
        {isPending ? '加载中...' : '获取数据'}
      </button>
      
      {error && (
        <div className="p-3 bg-red-900/50 border border-red-700 rounded-md mb-4">
          <p className="text-red-300">{error}</p>
          {!state.isOnline && (
            <p className="text-sm text-gray-400 mt-2">
              离线状态下，请求已加入队列
            </p>
          )}
        </div>
      )}
      
      {data && (
        <pre className="p-3 bg-gray-800 rounded-md overflow-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ============ 主演示页面 ============

export default function ServiceWorkerExamplePage() {
  return (
    <LayoutWithSWStatus>
      <div className="min-h-screen bg-gray-950 text-white">
        <NavbarWithStatus />
        
        <main className="container mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold mb-8">Service Worker 功能演示</h1>
          
          <div className="grid gap-8">
            {/* 基本状态 */}
            <section>
              <h2 className="text-xl font-semibold mb-4">基本状态</h2>
              <BasicStatusExample />
            </section>
            
            {/* 完整功能 */}
            <section>
              <h2 className="text-xl font-semibold mb-4">完整功能</h2>
              <FullFeaturedExample />
            </section>
            
            {/* 离线友好 */}
            <section>
              <h2 className="text-xl font-semibold mb-4">离线友好数据获取</h2>
              <OfflineFriendlyDataFetcher />
            </section>
            
            {/* 使用说明 */}
            <section className="p-6 bg-gray-900 rounded-lg">
              <h2 className="text-xl font-semibold mb-4">使用说明</h2>
              <div className="prose prose-invert max-w-none">
                <h3>如何在你的组件中使用</h3>
                <pre className="bg-gray-800 p-4 rounded-lg overflow-auto">
{`'use client';

import { useServiceWorker } from '@/hooks/use-service-worker';

export function MyComponent() {
  const {
    state,
    hasUpdate,
    isSyncing,
    applyUpdate,
    clearCache,
  } = useServiceWorker();
  
  return (
    <div>
      <p>网络: {state.isOnline ? '在线' : '离线'}</p>
      {hasUpdate && (
        <button onClick={() => {
          applyUpdate();
          window.location.reload();
        }}>
          更新
        </button>
      )}
    </div>
  );
}`}
                </pre>
                
                <h3 className="mt-6">简化版本</h3>
                <pre className="bg-gray-800 p-4 rounded-lg overflow-auto">
{`import { useServiceWorkerStatus } from '@/hooks/use-service-worker';

export function SimpleStatus() {
  const { isOnline, hasUpdate } = useServiceWorkerStatus();
  
  return (
    <div>
      {isOnline ? '🟢' : '🔴'} {isOnline ? '在线' : '离线'}
      {hasUpdate && ' 🆕'}
    </div>
  );
}`}
                </pre>
              </div>
            </section>
          </div>
        </main>
      </div>
    </LayoutWithSWStatus>
  );
}