import { Link } from "react-router";
import { motion } from "motion/react";
import { PageHeader, Section } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocs } from "@/hooks/queries";
import { EASE_OUT } from "@/lib/motion";
import { LifeOfAnAction } from "./LifeOfAnAction";

export function LearnIndex() {
  const docs = useDocs();
  return (
    <>
      <PageHeader title="Learn">
        How OneShot keeps its promises, and where it cannot. Scroll through the life of one action first; then read the concept documents. They are the same sources the PDFs are built from, so the two never disagree.
      </PageHeader>
      <Section title="The life of one action" about="A text message whose response gets lost, and every branch it could take.">
        <LifeOfAnAction />
      </Section>
      <Section title="Concept documents" about="Each covers the problem, diagrams including failure paths, the code that implements it, real test output, and what it cannot protect against.">
        {!docs.data ? (
          <Skeleton className="h-64 rounded-[14px]" />
        ) : (
          <ol className="divide-y overflow-hidden rounded-[14px] border bg-card">
            {docs.data.map((d, i) => (
              <motion.li key={d.slug} initial={{ opacity: 0, y: 6 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.3, delay: Math.min(i, 6) * 0.03, ease: EASE_OUT }}>
                <Link to={`/learn/${d.slug}`} className="group flex items-baseline gap-4 px-5 py-4 transition-colors hover:bg-muted/50">
                  <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{d.slug === "experiments" ? "" : d.slug.slice(0, 2)}</span>
                  <span className="flex-1 font-medium group-hover:underline group-hover:underline-offset-4">{d.title}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{Math.max(1, Math.round(d.words / 230))} min read</span>
                </Link>
              </motion.li>
            ))}
          </ol>
        )}
      </Section>
    </>
  );
}
