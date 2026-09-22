import { useEffect, useRef } from 'react';

/**
 * The useTimeout function is a custom hook that sets a timeout for a given callback function.
 * It takes in a callback function and a delay time in milliseconds as parameters.
 * It returns nothing.
 */
function useTimeout(callback: () => void, delay: number) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;

    if (delay !== null && callback && typeof callback === 'function') {
      timer = setTimeout(() => callbackRef.current(), delay);
    }

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
    // deps 不能包含 callback：callback（通常是内联函数）每次渲染都是新引用，
    // 会不断重置定时器。回调经 ref 间接调用，定时器只随 delay 变化重启。
  }, [delay]);
}

export default useTimeout;
