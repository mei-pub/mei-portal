import type React from "react";
import type { FC } from "react";
import { cn } from "@/utils";

interface PageContainerProps {
  children: React.ReactNode | null;
  titleExtra?: React.ReactNode | null;
  rightExtra?: React.ReactNode | null;
  title?: React.ReactNode | null;
  className?: string;
  wrapperClassName?: string;
}

const PageContainer: FC<PageContainerProps> = ({
  children,
  titleExtra,
  rightExtra,
  title,
  className,
  wrapperClassName,
}) => {
  return (
    <div className={cn("flex h-full flex-col gap-3 p-3", wrapperClassName)}>
      {title && (
        <div className="flex flex-row items-center justify-between px-1 pb-1 shrink-0">
          <div className="flex flex-row gap-3">
            <div className="text-sm font-medium text-[#343434] dark:text-white">
              {title}
            </div>
            {titleExtra && <div>{titleExtra}</div>}
          </div>
          {rightExtra && <div>{rightExtra}</div>}
        </div>
      )}

      <div className={cn("flex-1 min-h-0 overflow-auto", className)}>{children}</div>
    </div>
  );
};

export default PageContainer;
