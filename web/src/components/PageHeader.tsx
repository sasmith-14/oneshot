import { motion } from "motion/react";
import { EASE_OUT } from "@/lib/motion";

export function PageHeader({ title, children, actions }: { title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b pb-6">
      <div className="min-w-0 max-w-2xl">
        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: EASE_OUT }}
          className="text-[28px] leading-tight font-semibold tracking-[-0.02em] sm:text-[34px]"
        >
          {title}
        </motion.h1>
        {children && <div className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, about, children, id, aside }: { title: string; about?: React.ReactNode; children: React.ReactNode; id?: string; aside?: React.ReactNode }) {
  return (
    <section id={id} className="mb-12">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {about && <p className="mt-0.5 text-sm text-muted-foreground">{about}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
