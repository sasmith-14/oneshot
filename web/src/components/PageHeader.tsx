import { SetHeadline } from "./SetHeadline";
import { cn } from "@/lib/utils";

/** A section front: the page's name set large in the serif, the standfirst
 * (one sentence on what the page is for), and the page's own actions. */
export function PageHeader({ title, children, actions, className }: { title: string; children?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <header className={cn("mb-14 grid gap-x-12 gap-y-6 lg:grid-cols-12 lg:items-end", className)}>
      <div className="min-w-0 lg:col-span-8">
        <SetHeadline text={title} className="t-display text-[clamp(3.25rem,7.4vw,6.5rem)]" />
        {children && <div className="t-stand mt-5">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 lg:col-span-4 lg:justify-end lg:pb-2">{actions}</div>}
    </header>
  );
}

/** A section of a page: a serif heading, an optional one-line explanation,
 * and an optional control on the right. */
export function Section({ title, about, children, id, aside, className }: { title: string; about?: React.ReactNode; children: React.ReactNode; id?: string; aside?: React.ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn("mb-24", className)}>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="max-w-3xl">
          <SetHeadline as="h2" id={id ? `${id}-title` : undefined} text={title} className="t-title text-[clamp(2rem,3.4vw,2.875rem)]" />
          {about && <p className="mt-2.5 text-[15.5px] leading-relaxed text-ink-2">{about}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
