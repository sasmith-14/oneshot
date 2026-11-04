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
      <Section title="The life of one action" about="A text message whose reply gets lost, and every branch it could take. Scroll, and the diagram follows the story.">
        <LifeOfAnAction />
      </Section>
      <Section title="Concept documents" about="Each covers the problem, diagrams including failure paths, the code that implements it, real test output, and what it cannot protect against.">
        {!docs.data ? (
          <Skeleton className="h-64 rounded-none bg-well" />
        ) : (
          <ol className="border-t-2 border-ink">
            {docs.data.map((d, i) => (
              <motion.li key={d.slug} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.4, delay: Math.min(i, 6) * 0.04, ease: EASE_OUT }} className="border-b border-rule">
                <Link to={`/learn/${d.slug}`} className="group flex items-baseline gap-4 py-5">
                  <span className="t-head text-[clamp(1.5rem,2.4vw,2rem)] transition-colors duration-200 group-hover:text-mark-ink">{d.title}</span>
                  <span aria-hidden className="mb-[0.35em] min-w-8 flex-1 border-b border-dotted border-ink-3" />
                  <span className="shrink-0 text-[14.5px] text-ink-2">{Math.max(1, Math.round(d.words / 230))} min read</span>
                </Link>
              </motion.li>
            ))}
          </ol>
        )}
      </Section>
    </>
  );
}
