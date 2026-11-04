import { SetHeadline } from "./SetHeadline";
import { cn } from "@/lib/utils";

/** The page's name, one sentence on what it is for, and its own actions. */
export function PageHeader({ title, children, actions, className }: { title: string; children?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <header className={cn("mb-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-5", className)}>
      <div className="min-w-0 max-w-3xl">
        <SetHeadline text={title} className="t-title" />
        {children && <div className="mt-2.5 text-[15px] leading-relaxed text-fg-2">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A titled block of a page, with an optional note and a control on the right. */
export function Section({ title, about, children, id, aside, className }: { title: string; about?: React.ReactNode; children: React.ReactNode; id?: string; aside?: React.ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn("mb-12", className)}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="max-w-3xl">
          <h2 id={id ? `${id}-title` : undefined} className="t-h2">{title}</h2>
          {about && <p className="mt-1 text-[13.5px] text-fg-2">{about}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A surface with an optional header row. */
export function Panel({ title, aside, children, className, bodyClassName, id }: { title?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section id={id} className={cn("panel min-w-0", className)}>
      {(title || aside) && (
        <div className="panel-head">
          {typeof title === "string" ? <h2 className="t-h3">{title}</h2> : title}
          {aside}
        </div>
      )}
      <div className={cn("p-[18px]", bodyClassName)}>{children}</div>
    </section>
  );
}
