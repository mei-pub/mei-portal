import type { DetailedHTMLProps, HTMLAttributes } from 'react';

// iconify-icon Web Component 的 JSX 类型声明
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'iconify-icon': DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          icon: string;
          width?: string | number;
          height?: string | number;
          flip?: string;
          rotate?: string | number;
          inline?: boolean;
          mode?: string;
          noobserver?: boolean;
        },
        HTMLElement
      >;
    }
  }
}

export {};
