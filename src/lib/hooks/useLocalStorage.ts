'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * localStorage Hook - 类型安全的 localStorage 读写
 * @param key localStorage 的键
 * @param initialValue 初始值
 * @returns [value, setValue, removeValue] 当前值、设置函数和删除函数
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  // 确保在 SSR 环境中安全
  const isClient = typeof window !== 'undefined';

  // 从 localStorage 读取初始值
  const readValue = useCallback((): T => {
    if (!isClient) {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  }, [key, initialValue, isClient]);

  // 状态管理
  const [storedValue, setStoredValue] = useState<T>(readValue);

  // 设置值的函数
  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      if (!isClient) {
        console.warn('localStorage is not available in SSR environment');
        return;
      }

      try {
        // 允许值是一个函数，类似于 useState
        const valueToStore = value instanceof Function ? value(storedValue) : value;
        
        // 保存到 state
        setStoredValue(valueToStore);
        
        // 保存到 localStorage
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
        
        // 触发自定义事件，以便其他标签页或组件可以监听
        window.dispatchEvent(new StorageEvent('storage', { key }));
      } catch (error) {
        console.warn(`Error setting localStorage key "${key}":`, error);
      }
    },
    [key, storedValue, isClient]
  );

  // 删除值的函数
  const removeValue = useCallback(() => {
    if (!isClient) {
      console.warn('localStorage is not available in SSR environment');
      return;
    }

    try {
      // 从 localStorage 删除
      window.localStorage.removeItem(key);
      
      // 恢复到初始值
      setStoredValue(initialValue);
      
      // 触发自定义事件
      window.dispatchEvent(new StorageEvent('storage', { key }));
    } catch (error) {
      console.warn(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, initialValue, isClient]);

  // 监听 storage 事件，以便在其他标签页中更新值
  useEffect(() => {
    if (!isClient) {
      return;
    }

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === key && event.newValue !== null) {
        try {
          setStoredValue(JSON.parse(event.newValue) as T);
        } catch (error) {
          console.warn(`Error parsing storage event for key "${key}":`, error);
        }
      } else if (event.key === key && event.newValue === null) {
        // 键被删除
        setStoredValue(initialValue);
      }
    };

    // 监听 storage 事件
    window.addEventListener('storage', handleStorageChange);

    // 清理事件监听器
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [key, initialValue, isClient]);

  // 同步初始值（如果 localStorage 中没有值）
  useEffect(() => {
    if (isClient) {
      const existingValue = window.localStorage.getItem(key);
      if (existingValue === null) {
        window.localStorage.setItem(key, JSON.stringify(initialValue));
      }
    }
  }, [key, initialValue, isClient]);

  return [storedValue, setValue, removeValue];
}

/**
 * localStorage Hook - 只读版本，不提供设置和删除功能
 * @param key localStorage 的键
 * @param defaultValue 默认值
 * @returns 当前值
 */
export function useLocalStorageReadonly<T>(key: string, defaultValue: T): T {
  const [value] = useLocalStorage(key, defaultValue);
  return value;
}

/**
 * localStorage Hook - 带有默认序列化/反序列化器的版本
 * @param key localStorage 的键
 * @param initialValue 初始值
 * @param serializer 自定义序列化函数
 * @param deserializer 自定义反序列化函数
 * @returns [value, setValue, removeValue]
 */
export function useLocalStorageWithSerializer<T>(
  key: string,
  initialValue: T,
  serializer: (value: T) => string = JSON.stringify,
  deserializer: (value: string) => T = JSON.parse
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const isClient = typeof window !== 'undefined';

  const readValue = useCallback((): T => {
    if (!isClient) {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      return item ? deserializer(item) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  }, [key, initialValue, isClient, deserializer]);

  const [storedValue, setStoredValue] = useState<T>(readValue);

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      if (!isClient) {
        console.warn('localStorage is not available in SSR environment');
        return;
      }

      try {
        const valueToStore = value instanceof Function ? value(storedValue) : value;
        setStoredValue(valueToStore);
        window.localStorage.setItem(key, serializer(valueToStore));
        window.dispatchEvent(new StorageEvent('storage', { key }));
      } catch (error) {
        console.warn(`Error setting localStorage key "${key}":`, error);
      }
    },
    [key, storedValue, isClient, serializer]
  );

  const removeValue = useCallback(() => {
    if (!isClient) {
      console.warn('localStorage is not available in SSR environment');
      return;
    }

    try {
      window.localStorage.removeItem(key);
      setStoredValue(initialValue);
      window.dispatchEvent(new StorageEvent('storage', { key }));
    } catch (error) {
      console.warn(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, initialValue, isClient]);

  useEffect(() => {
    if (!isClient) {
      return;
    }

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === key && event.newValue !== null) {
        try {
          setStoredValue(deserializer(event.newValue));
        } catch (error) {
          console.warn(`Error parsing storage event for key "${key}":`, error);
        }
      } else if (event.key === key && event.newValue === null) {
        setStoredValue(initialValue);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key, initialValue, isClient, deserializer]);

  useEffect(() => {
    if (isClient) {
      const existingValue = window.localStorage.getItem(key);
      if (existingValue === null) {
        window.localStorage.setItem(key, serializer(initialValue));
      }
    }
  }, [key, initialValue, isClient, serializer]);

  return [storedValue, setValue, removeValue];
}

export default useLocalStorage;