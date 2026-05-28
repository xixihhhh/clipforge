'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * 防抖 Hook - 用于搜索输入等场景
 * @param value 要防抖的值
 * @param delay 延迟时间（毫秒），默认 300ms
 * @returns 防抖后的值
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const valueRef = useRef<T>(value);

  useEffect(() => {
    // 更新引用值
    valueRef.current = value;
    
    // 设置新的定时器
    timeoutRef.current = setTimeout(() => {
      setDebouncedValue(valueRef.current);
    }, delay);

    // 清理函数：清除定时器
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * 防抖函数 Hook - 返回一个防抖后的函数
 * @param fn 要防抖的函数
 * @param delay 延迟时间（毫秒），默认 300ms
 * @returns 防抖后的函数
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  fn: T,
  delay: number = 300
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const fnRef = useRef<T>(fn);
  const argsRef = useRef<any[]>([]);

  // 更新函数引用
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const debouncedFn = useCallback(
    (...args: any[]) => {
      argsRef.current = args;
      
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        fnRef.current(...argsRef.current);
      }, delay);
    },
    [delay]
  ) as T;

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedFn;
}

/**
 * 带有取消功能的防抖函数 Hook
 * @param fn 要防抖的函数
 * @param delay 延迟时间（毫秒），默认 300ms
 * @returns [debouncedFn, cancel] 防抖后的函数和取消函数
 */
export function useCancellableDebounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number = 300
): [T, () => void] {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const fnRef = useRef<T>(fn);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const debouncedFn = useCallback(
    (...args: any[]) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        fnRef.current(...args);
      }, delay);
    },
    [delay]
  ) as T;

  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return [debouncedFn, cancel];
}

export default useDebounce;