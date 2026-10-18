import * as React from "react"
import { cn } from "cn"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "lucide-react"

import { buttonVariants, type Button } from "~/components/ui/button"
import { useMessages } from "~/components/ui/messages"

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  const { t } = useMessages()
  return (
    <nav
      role="navigation"
      aria-label={t("التنقل بين الصفحات")}
      data-slot="التنقل بين الصفحات"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  )
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex flex-row items-center gap-1", className)}
      {...props}
    />
  )
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
} & Pick<React.ComponentProps<typeof Button>, "size"> &
  React.ComponentProps<"a">

function PaginationLink({
  className,
  isActive,
  size = "icon",
  ...props
}: PaginationLinkProps) {
  return (
    <a
      aria-current={isActive ? "page" : undefined}
      data-slot="pagination-link"
      data-active={isActive}
      className={cn(
        buttonVariants({
          variant: isActive ? "outline" : "ghost",
          size,
        }),
        className
      )}
      {...props}
    />
  )
}

function PaginationPrevious({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) {
  const { t } = useMessages()
  return (
    <PaginationLink
      aria-label={t("الصفحة السابقة")}
      size="default"
      className={cn("gap-1 px-2.5 sm:ps-2.5", className)}
      {...props}
    >
      <ChevronLeftIcon className="rtl:rotate-180" />
      <span className="hidden sm:block">{t("السابق")}</span>
    </PaginationLink>
  )
}

function PaginationNext({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) {
  const { t } = useMessages()
  return (
    <PaginationLink
      aria-label={t("الصفحة التالية")}
      size="default"
      className={cn("gap-1 px-2.5 sm:pe-2.5", className)}
      {...props}
    >
      <span className="hidden sm:block">{t("التالي")}</span>
      <ChevronRightIcon className="rtl:rotate-180" />
    </PaginationLink>
  )
}

function PaginationEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  const { t } = useMessages()
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn("flex size-9 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontalIcon className="size-4" />
      <span className="sr-only">{t("صفحات أخرى")}</span>
    </span>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationLink,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
}
